#!/usr/bin/env python3
"""Guarded maintenance entry point for the shared question pool."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from typing import Any

from sqlalchemy import select


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.question import QuestionCleanupAudit  # noqa: E402
from app.schemas.question_cleanup import (  # noqa: E402
    QuestionCleanupReport,
    QuestionCleanupReviewDecisionFile,
)
from app.services.question_cleanup_service import (  # noqa: E402
    QuestionCleanupBackupReceipt,
    apply_cleanup,
    apply_review_decisions,
    build_report,
    calculate_manifest_hash,
)
from app.services import teaching_content_revision_service  # noqa: E402


APPLY_RESULT_FORMAT_VERSION = "question-cleanup-apply-result-v1"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report, apply, and verify guarded shared-question cleanup.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    report = subcommands.add_parser(
        "report",
        help="Write a content-addressed, read-only cleanup report.",
    )
    report.add_argument("--output", type=Path, required=True)
    report.add_argument(
        "--decisions",
        type=Path,
        help="Resolve the report's complete review set from a decision file.",
    )
    template = subcommands.add_parser(
        "decisions-template",
        help=(
            "Build a complete delete_non_imported decision file from an existing "
            "report without accessing the database."
        ),
    )
    template.add_argument("--report", type=Path, required=True)
    template.add_argument("--output", type=Path, required=True)
    template.add_argument("--reason", required=True)
    template.add_argument(
        "--confirm",
        required=True,
        help=(
            "Explicitly authorize marking every review row delete_non_imported; "
            "type DELETE-NON-IMPORTED-REVIEW:<first 12 manifestHash characters>."
        ),
    )
    apply = subcommands.add_parser(
        "apply",
        help="Apply one approved manifest with an exact external backup receipt.",
    )
    apply.add_argument("--report", type=Path, required=True)
    apply.add_argument("--backup", type=Path, required=True)
    apply.add_argument("--backup-sha256", required=True)
    apply.add_argument("--confirm", required=True)
    apply.add_argument("--output", type=Path, required=True)
    verify = subcommands.add_parser(
        "verify",
        help="Verify a committed cleanup against live data and its immutable audit.",
    )
    verify.add_argument("--apply-result", type=Path, required=True)
    return parser.parse_args(argv)


def _load_report(path: Path) -> QuestionCleanupReport:
    report = QuestionCleanupReport.model_validate_json(path.read_text(encoding="utf-8"))
    if calculate_manifest_hash(report) != report.manifest_hash:
        raise ValueError(f"report manifestHash does not match its content: {path}")
    return report


def _load_review_decisions(path: Path) -> QuestionCleanupReviewDecisionFile:
    return QuestionCleanupReviewDecisionFile.model_validate_json(
        path.read_text(encoding="utf-8")
    )


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_json_secure_atomic(path: Path, payload: object) -> None:
    """Atomically replace one result file with owner-only permissions."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        serialized = (
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        ).encode("utf-8")
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = -1
            stream.write(serialized)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        temporary_path.unlink(missing_ok=True)


def _preflight_secure_atomic_output(path: Path) -> None:
    """Fail before destructive work when the result directory is not writable."""

    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("apply result output must not be a symbolic link")
    if path.exists() and not path.is_file():
        raise ValueError("apply result output must be a regular file")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.preflight.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        os.fchmod(descriptor, 0o600)
    finally:
        os.close(descriptor)
        Path(temporary_name).unlink(missing_ok=True)


def _paths_alias(first: Path, second: Path) -> bool:
    if first.resolve() == second.resolve():
        return True
    try:
        return first.exists() and second.exists() and first.samefile(second)
    except OSError:
        return False


def _is_within(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
    except ValueError:
        return False
    return True


def _sha256_open_regular_file(path: Path) -> tuple[str, int, int]:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ValueError(f"backup cannot be opened as a regular file: {path}") from exc
    try:
        file_stat = os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode):
            raise ValueError(f"backup must be a regular file: {path}")
        digest = hashlib.sha256()
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
        return digest.hexdigest(), int(file_stat.st_dev), int(file_stat.st_ino)
    finally:
        os.close(descriptor)


def _validate_external_backup(
    path: Path,
    expected_sha256: str,
) -> tuple[Path, str, int, int]:
    if not path.is_absolute():
        raise ValueError("backup path must be absolute")
    try:
        path_stat = path.lstat()
    except OSError as exc:
        raise ValueError(f"backup path does not exist: {path}") from exc
    if stat.S_ISLNK(path_stat.st_mode):
        raise ValueError("backup path must not be a symbolic link")
    if not stat.S_ISREG(path_stat.st_mode):
        raise ValueError("backup path must be a regular file")

    resolved = path.resolve(strict=True)
    if _is_within(resolved, REPOSITORY_ROOT):
        raise ValueError("backup must be stored outside the repository")
    actual_sha256, device, inode = _sha256_open_regular_file(resolved)
    supplied_sha256 = str(expected_sha256 or "")
    if not hmac.compare_digest(actual_sha256, supplied_sha256):
        raise ValueError("backup SHA-256 does not match its bytes")
    return resolved, actual_sha256, device, inode


def _load_apply_result(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("apply result must be a JSON object")
    required = {
        "formatVersion",
        "auditId",
        "actor",
        "manifestHash",
        "snapshotHash",
        "totalCount",
        "retainedQuestions",
        "deletedQuestionIds",
        "repairedReferenceCount",
        "preservedReferenceCount",
        "repairSummary",
        "teachingRevision",
        "backup",
        "completedAt",
        "approvedReport",
    }
    missing = sorted(required - set(raw))
    if missing:
        raise ValueError(f"apply result is missing required fields: {missing}")
    if raw["formatVersion"] != APPLY_RESULT_FORMAT_VERSION:
        raise ValueError("unsupported apply result formatVersion")
    if not isinstance(raw["retainedQuestions"], list):
        raise ValueError("apply result retainedQuestions must be a list")
    if not isinstance(raw["deletedQuestionIds"], list):
        raise ValueError("apply result deletedQuestionIds must be a list")
    if not isinstance(raw["repairSummary"], dict):
        raise ValueError("apply result repairSummary must be an object")
    if not isinstance(raw["backup"], dict):
        raise ValueError("apply result backup must be an object")
    return raw


def _load_bound_approved_report(result: dict[str, Any]) -> QuestionCleanupReport:
    try:
        report = QuestionCleanupReport.model_validate(result["approvedReport"])
    except Exception as exc:
        raise ValueError(f"apply result approvedReport is invalid: {exc}") from exc
    if calculate_manifest_hash(report) != report.manifest_hash:
        raise ValueError("approved report manifest hash does not match its content")
    if report.manifest_hash != result["manifestHash"]:
        raise ValueError("approved report manifest is not bound to the apply result")
    if report.snapshot_hash != result["snapshotHash"]:
        raise ValueError("approved report snapshot is not bound to the apply result")
    if report.review or report.summary.review_count:
        raise ValueError("approved report still contains review rows")
    return report


def _validate_confirmation(report: QuestionCleanupReport, confirmation: str) -> None:
    expected = f"DELETE-QUESTION-POOL:{report.manifest_hash[:12]}"
    if not hmac.compare_digest(expected, str(confirmation or "")):
        raise ValueError("typed confirmation token does not match")


def _build_apply_result_payload(
    report: QuestionCleanupReport,
    *,
    audit_id: str,
    actor: str,
    backup_path: Path,
    backup_sha256: str,
    deleted_question_ids: list[str],
    repaired_reference_count: int,
    preserved_reference_count: int,
    repair_summary: dict[str, object],
    teaching_revision: int,
    completed_at: object,
) -> dict[str, object]:
    retained_questions = [
        {
            "questionId": row.question_id,
            "sourceFingerprint": row.source_fingerprint,
        }
        for row in sorted(report.keep, key=lambda item: item.question_id)
    ]
    completed_at_value = (
        completed_at.isoformat()
        if hasattr(completed_at, "isoformat")
        else str(completed_at)
    )
    return {
        "formatVersion": APPLY_RESULT_FORMAT_VERSION,
        "auditId": audit_id,
        "actor": actor,
        "manifestHash": report.manifest_hash,
        "snapshotHash": report.snapshot_hash,
        "totalCount": report.summary.total_count,
        "retainedQuestions": retained_questions,
        "deletedQuestionIds": sorted(deleted_question_ids),
        "repairedReferenceCount": repaired_reference_count,
        "preservedReferenceCount": preserved_reference_count,
        "repairSummary": repair_summary,
        "teachingRevision": teaching_revision,
        "backup": {
            "path": str(backup_path),
            "sha256": backup_sha256,
        },
        "completedAt": completed_at_value,
        "approvedReport": report.model_dump(mode="json", by_alias=True),
    }


async def run_report(output: Path, decisions_path: Path | None = None) -> int:
    if decisions_path is not None and _paths_alias(output, decisions_path):
        raise ValueError("report output must not overwrite the decision file")
    async with AsyncSessionLocal() as db:
        report = await build_report(db)
    if decisions_path is not None:
        report = apply_review_decisions(
            report,
            _load_review_decisions(decisions_path),
        )

    payload = report.model_dump(mode="json", by_alias=True)
    _write_json(output, payload)
    print(
        json.dumps(
            {
                "totalCount": report.summary.total_count,
                "keepCount": report.summary.keep_count,
                "deleteCount": report.summary.delete_count,
                "reviewCount": report.summary.review_count,
                "referenceCount": report.summary.reference_count,
                "snapshotHash": report.snapshot_hash,
                "manifestHash": report.manifest_hash,
                "output": str(output),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 2 if report.summary.review_count > 0 else 0


async def run_apply(
    report_path: Path,
    backup: Path,
    backup_sha256: str,
    confirmation: str,
    output: Path,
) -> int:
    if _paths_alias(output, report_path):
        raise ValueError("apply result output must not overwrite the approved report")
    if _paths_alias(output, backup):
        raise ValueError("apply result output must not overwrite the backup")
    report = _load_report(report_path)
    _validate_confirmation(report, confirmation)
    verified_backup, verified_sha256, backup_device, backup_inode = (
        _validate_external_backup(
            backup,
            backup_sha256,
        )
    )
    _preflight_secure_atomic_output(output)

    actor = "admin"
    async with AsyncSessionLocal() as recovery_db:
        prior_audit = (
            await recovery_db.execute(
                select(QuestionCleanupAudit).where(
                    QuestionCleanupAudit.manifest_hash == report.manifest_hash
                )
            )
        ).scalar_one_or_none()
    if prior_audit is not None:
        payload = _build_apply_result_payload(
            report,
            audit_id=prior_audit.id,
            actor=actor,
            backup_path=verified_backup,
            backup_sha256=verified_sha256,
            deleted_question_ids=list(prior_audit.deleted_question_ids),
            repaired_reference_count=prior_audit.repaired_reference_count,
            preserved_reference_count=prior_audit.preserved_reference_count,
            repair_summary=dict(prior_audit.repair_summary),
            teaching_revision=prior_audit.teaching_revision,
            completed_at=prior_audit.completed_at,
        )
        await _verify_result_payload(payload)
        _write_json_secure_atomic(output, payload)
        print(
            json.dumps(
                {
                    "recovered": True,
                    "auditId": prior_audit.id,
                    "manifestHash": prior_audit.manifest_hash,
                    "retainedCount": prior_audit.retained_count,
                    "deletedCount": prior_audit.deleted_count,
                    "teachingRevision": prior_audit.teaching_revision,
                    "output": str(output),
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 0

    async with AsyncSessionLocal() as db:
        result = await apply_cleanup(
            db,
            report,
            actor=actor,
            backup_receipt=QuestionCleanupBackupReceipt(
                path=str(verified_backup),
                sha256=verified_sha256,
                confirmation=confirmation,
                device=backup_device,
                inode=backup_inode,
            ),
        )

    payload = _build_apply_result_payload(
        report,
        audit_id=result.audit_id,
        actor=actor,
        backup_path=verified_backup,
        backup_sha256=verified_sha256,
        deleted_question_ids=result.deleted_question_ids,
        repaired_reference_count=result.repaired_reference_count,
        preserved_reference_count=result.preserved_reference_count,
        repair_summary=result.repair_summary,
        teaching_revision=result.teaching_revision,
        completed_at=result.completed_at,
    )
    _write_json_secure_atomic(output, payload)
    print(
        json.dumps(
            {
                "auditId": result.audit_id,
                "manifestHash": result.manifest_hash,
                "retainedCount": len(report.keep),
                "deletedCount": len(result.deleted_question_ids),
                "teachingRevision": result.teaching_revision,
                "recovered": False,
                "output": str(output),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


def _normalized_retained_questions(result: dict[str, Any]) -> dict[str, str]:
    retained: dict[str, str] = {}
    for row in result["retainedQuestions"]:
        if not isinstance(row, dict):
            raise ValueError("apply result retainedQuestions rows must be objects")
        question_id = row.get("questionId")
        fingerprint = row.get("sourceFingerprint")
        if not isinstance(question_id, str) or not question_id:
            raise ValueError("apply result retained questionId is invalid")
        if question_id in retained:
            raise ValueError(f"apply result has duplicate retained question: {question_id}")
        if (
            not isinstance(fingerprint, str)
            or len(fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in fingerprint)
        ):
            raise ValueError(
                f"apply result retained sourceFingerprint is invalid: {question_id}"
            )
        retained[question_id] = fingerprint
    return retained


async def _verify_result_payload(result: dict[str, Any]) -> dict[str, object]:
    approved_report = _load_bound_approved_report(result)
    retained = _normalized_retained_questions(result)
    manifest_retained = {
        row.question_id: row.source_fingerprint
        for row in approved_report.keep
    }
    if retained != manifest_retained:
        raise ValueError(
            "retainedQuestions do not match the manifest-bound approved report"
        )
    deleted_ids = result["deletedQuestionIds"]
    if not all(isinstance(question_id, str) and question_id for question_id in deleted_ids):
        raise ValueError("apply result deletedQuestionIds contains an invalid ID")
    if len(set(deleted_ids)) != len(deleted_ids):
        raise ValueError("apply result deletedQuestionIds contains duplicates")
    deleted = set(deleted_ids)
    manifest_deleted = {row.question_id for row in approved_report.delete}
    if deleted != manifest_deleted:
        raise ValueError(
            "deletedQuestionIds do not match the manifest-bound approved report"
        )
    expected_repaired_count = sum(
        reference.question_id in manifest_deleted
        and reference.repair_action == "remove_question_and_recalculate"
        for reference in approved_report.references
    )
    expected_preserved_count = sum(
        reference.question_id in manifest_deleted
        and reference.repair_action == "preserve_historical_snapshot"
        for reference in approved_report.references
    )
    if result["totalCount"] != approved_report.summary.total_count:
        raise ValueError("apply result totalCount does not match approved report")
    if result["repairedReferenceCount"] != expected_repaired_count:
        raise ValueError(
            "apply result repairedReferenceCount does not match approved report"
        )
    if result["preservedReferenceCount"] != expected_preserved_count:
        raise ValueError(
            "apply result preservedReferenceCount does not match approved report"
        )

    backup = result["backup"]
    backup_path = backup.get("path")
    backup_sha256 = backup.get("sha256")
    if not isinstance(backup_path, str) or not isinstance(backup_sha256, str):
        raise ValueError("apply result backup receipt is invalid")
    verified_backup, verified_sha256, _, _ = _validate_external_backup(
        Path(backup_path),
        backup_sha256,
    )

    async with AsyncSessionLocal() as db:
        current = await build_report(db)
        if current.delete:
            delete_ids = sorted(row.question_id for row in current.delete)
            raise ValueError(
                f"post-apply classifier delete set is not empty: {delete_ids}"
            )
        current_rows = {
            row.question_id: row
            for row in [*current.keep, *current.review]
        }
        expected_ids = set(retained)
        current_ids = set(current_rows)
        if current_ids != expected_ids:
            missing = sorted(expected_ids - current_ids)
            extra = sorted(current_ids - expected_ids)
            raise ValueError(
                "retained question IDs changed after apply: "
                f"missing={missing}, extra={extra}"
            )
        fingerprint_mismatches = sorted(
            question_id
            for question_id, fingerprint in retained.items()
            if current_rows[question_id].source_fingerprint != fingerprint
        )
        if fingerprint_mismatches:
            raise ValueError(
                "retained question source fingerprints changed after apply: "
                f"{fingerprint_mismatches}"
            )

        live_dangling = sorted(
            reference.reference_id
            for reference in current.references
            if reference.repair_action == "remove_question_and_recalculate"
            and reference.question_id not in current_ids
        )
        if live_dangling:
            raise ValueError(
                f"live reference repair is incomplete: {live_dangling}"
            )

        audit_id = result["auditId"]
        if not isinstance(audit_id, str) or not audit_id:
            raise ValueError("apply result auditId is invalid")
        audit = await db.get(QuestionCleanupAudit, audit_id)
        if audit is None:
            raise ValueError(f"cleanup audit row is missing: {audit_id}")
        revision = await teaching_content_revision_service.current(db)

        expected_audit = {
            "manifestHash": result["manifestHash"],
            "snapshotHash": result["snapshotHash"],
            "actor": result["actor"],
            "backupPath": str(verified_backup),
            "backupSha256": verified_sha256,
            "totalCount": result["totalCount"],
            "retainedCount": len(retained),
            "deletedCount": len(deleted),
            "repairedReferenceCount": result["repairedReferenceCount"],
            "preservedReferenceCount": result["preservedReferenceCount"],
            "deletedQuestionIds": sorted(deleted),
            "repairSummary": result["repairSummary"],
            "teachingRevision": result["teachingRevision"],
            "completedAt": result["completedAt"],
        }
        actual_audit = {
            "manifestHash": audit.manifest_hash,
            "snapshotHash": audit.snapshot_hash,
            "actor": audit.actor_username,
            "backupPath": audit.backup_path,
            "backupSha256": audit.backup_sha256,
            "totalCount": audit.total_count,
            "retainedCount": audit.retained_count,
            "deletedCount": audit.deleted_count,
            "repairedReferenceCount": audit.repaired_reference_count,
            "preservedReferenceCount": audit.preserved_reference_count,
            "deletedQuestionIds": sorted(audit.deleted_question_ids),
            "repairSummary": audit.repair_summary,
            "teachingRevision": audit.teaching_revision,
            "completedAt": audit.completed_at.isoformat(),
        }
        if actual_audit != expected_audit:
            mismatches = sorted(
                key
                for key in expected_audit
                if expected_audit[key] != actual_audit[key]
            )
            raise ValueError(f"cleanup audit does not match apply result: {mismatches}")

        if revision["revision"] != audit.teaching_revision:
            raise ValueError(
                "teaching revision does not match cleanup audit: "
                f"current={revision['revision']}, audit={audit.teaching_revision}"
            )
        if revision["changes"] != [
            {
                "entityType": "question_pool",
                "entityId": audit.manifest_hash,
                "action": "cleanup",
            }
        ]:
            raise ValueError("teaching revision cleanup change does not match audit")

    return {
        "verified": True,
        "auditId": result["auditId"],
        "manifestHash": result["manifestHash"],
        "retainedCount": len(retained),
        "deletedCount": len(deleted),
        "teachingRevision": result["teachingRevision"],
    }


async def run_verify(apply_result_path: Path) -> int:
    result = _load_apply_result(apply_result_path)
    verification = await _verify_result_payload(result)
    print(
        json.dumps(
            verification,
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


def run_decisions_template(
    report_path: Path,
    output: Path,
    reason: str,
    confirmation: str,
) -> int:
    if _paths_alias(report_path, output):
        raise ValueError("decision output must not overwrite the source report")
    report = _load_report(report_path)
    expected_confirmation = (
        f"DELETE-NON-IMPORTED-REVIEW:{report.manifest_hash[:12]}"
    )
    if not hmac.compare_digest(confirmation, expected_confirmation):
        raise ValueError(
            "confirmation must exactly authorize all review rows as "
            f"delete_non_imported: {expected_confirmation}"
        )
    decision_file = QuestionCleanupReviewDecisionFile.model_validate(
        {
            "manifestHash": report.manifest_hash,
            "decisions": [
                {
                    "questionId": item.question_id,
                    "decision": "delete_non_imported",
                    "reason": reason,
                }
                for item in sorted(report.review, key=lambda row: row.question_id)
            ],
        }
    )
    _write_json(
        output,
        decision_file.model_dump(mode="json", by_alias=True),
    )
    print(
        json.dumps(
            {
                "manifestHash": decision_file.manifest_hash,
                "decisionCount": len(decision_file.decisions),
                "decision": "delete_non_imported",
                "confirmation": confirmation,
                "output": str(output),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


async def run(args: argparse.Namespace) -> int:
    if args.command == "report":
        return await run_report(args.output, args.decisions)
    if args.command == "decisions-template":
        return run_decisions_template(
            args.report,
            args.output,
            args.reason,
            args.confirm,
        )
    if args.command == "apply":
        return await run_apply(
            args.report,
            args.backup,
            args.backup_sha256,
            args.confirm,
            args.output,
        )
    if args.command == "verify":
        return await run_verify(args.apply_result)
    raise ValueError(f"unsupported command: {args.command}")


def main(argv: list[str] | None = None) -> int:
    if argv is not None:
        return asyncio.run(run(parse_args(argv)))
    try:
        return asyncio.run(run(parse_args(None)))
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
