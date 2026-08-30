"""Runtime State retirement orchestration and payload-free public reports.

The detailed, resumable migration ledger remains owned by
``runtime_domain_migration_service``.  This module deliberately adds no second
ledger: it classifies the remaining course sources, delegates state-machine
work, and exposes only identifiers, counts, dispositions, and hashes.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course_management import CourseDraft, CourseRelease, LearningTask
from app.models.runtime_migration import RuntimeMigrationItem
from app.models.user import User
from app.services import (
    files_runtime_migration_service as files_migration,
    question_migration_service as question_migration,
    runtime_domain_migration_service as domain_migration,
)


COURSE_DRAFTS_KEY = "kg_course_config_drafts_v1"
COURSE_RELEASES_KEY = "kg_course_config_releases_v1"
ACTIVE_COURSE_RELEASE_KEY = "kg_course_config_active_release_v1"
LEARNING_TASKS_KEY = "kg_learning_tasks_v1"
COURSE_SOURCE_KEYS = {
    COURSE_DRAFTS_KEY,
    COURSE_RELEASES_KEY,
    ACTIVE_COURSE_RELEASE_KEY,
    LEARNING_TASKS_KEY,
}

FILE_EXACT_KEYS = {
    files_migration.INDEX_KEY,
    files_migration.CURRENT_KEY,
    files_migration.TAGS_KEY,
    files_migration.FOLDERS_KEY,
}
QUESTION_EXACT_KEYS = {
    question_migration.PUBLISHED_BANK_KEY,
    question_migration.PAPER_SHARED_DRAFT_KEY,
    question_migration.PAPER_SHARED_CATEGORY_KEY,
}
QUESTION_PREFIXES = (
    question_migration.PRIVATE_BANK_PREFIX,
    question_migration.PAPER_DRAFT_PREFIX,
    question_migration.PAPER_CATEGORY_PREFIX,
)
DEVICE_PREFERENCE_EXACT_KEYS = {
    "kg_default_entry_mode_v1", "kg_question_language_mode_v1",
    "kg_global_shortcuts_layout_v1", "kg_global_shortcuts_position_v1",
    "kg_graph_user_preferences_v1", "kg_canvas_view_preferences_v1",
    "kg_graph_recent_colors_v1", "kg_home_interaction_mode_v1",
    "kg_home_professional_flow_v1", "kg_graph_closed_tabs_v1",
    "kg_file_manager_details_open_v1", "kg_file_manager_folder_section_collapsed_v1",
    "kg_file_manager_layout_v1", "kg_file_manager_recent_folders_v1",
    "kg_file_manager_sidebar_collapsed_v1", "kg_file_manager_sort_v1",
    "kg_file_manager_theme_v1", "kg_deep_recall_theme_v1",
    "kg_multi_question_analysis_sections_v1", "kg_multi_question_font_scale_v1",
    "kg_multi_question_highlight_color_v1", "kg_multi_question_paper_selection_v1",
    "kg_multi_question_release_selection_v1", "kg_paper_workspace_layout_v1",
    "kg_question_classification_collapsed_v1", "kg_question_library_workspace_layout_v1",
    "kg_question_training_filters_collapsed_v1", "kg_question_training_workspace_layout_v1",
    "kg_teacher_workbench_subject_v1", "kg_course_admin_workspace_v862_p1",
    "kg_course_admin_recent_v862_p2", "kg_training_workspace_layout_v1",
    "pmp_question_font_size_v1", "pmp_question_font_size_v2",
}
DEVICE_PREFERENCE_PREFIXES = (
    "kg_resizable_", "kg_ui_resizable_region_", "kg_workspace_layout_",
    "kg_recent_selection_", "kg_font_", "kg_language_", "kg_theme_",
)
DISPOSABLE_MARKERS = {
    "kg_graph_file_migration_v2", "kg_graph_recent_opened_migration_v1",
    "kg_content_organization_migration_v1", "kg_deep_recall_theme_platform_migrated_v1",
    "kg_subscription_plan_model_v2_migrated", "kg_deep_recall_legacy_owner_v1",
    "kg_teacher_shared_runtime_promotion_v1", "kg_guided_practice_return_v1",
    "kg_wechat_login_pending_v1",
}

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_POLICY_PATHS = (
    REPOSITORY_ROOT / "backend/app/web/runtime_page_policy.json",
    REPOSITORY_ROOT / "frontend/scripts/runtime-page-policy.json",
)

_PAYLOAD_KEYS = {
    "payload",
    "source_payload",
    "canonical_payload",
    "source_snapshot_payload",
}


def canonical_hash(value: Any) -> str:
    """Return the shared canonical compact-JSON SHA-256 digest."""

    return domain_migration.canonical_json_hash(value)


def sanitize_public_report(value: Any) -> Any:
    """Recursively remove business payloads from a public migration report."""

    if isinstance(value, Mapping):
        return {
            str(key): sanitize_public_report(item)
            for key, item in value.items()
            if str(key) not in _PAYLOAD_KEYS
        }
    if isinstance(value, list):
        return [sanitize_public_report(item) for item in value]
    return value


def _policy_is_empty(path: Path) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    return isinstance(payload, Mapping) and payload.get("runtimePages") == []


def evaluate_drop_gate(
    verification: Mapping[str, Any],
    *,
    policy_paths: Iterable[Path] = DEFAULT_POLICY_PATHS,
) -> dict[str, Any]:
    """Apply the final no-loss/no-policy gate without executing any DDL."""

    blockers: list[str] = []
    for metric, blocker in (
        ("unknown", "unknown"),
        ("parseErrors", "parseError"),
        ("hashMismatches", "hashMismatch"),
        ("unresolvedConflicts", "unresolvedConflict"),
    ):
        if int(verification.get(metric) or 0) > 0:
            blockers.append(blocker)
    paths = tuple(Path(path) for path in policy_paths)
    policies_empty = len(paths) == 2 and all(_policy_is_empty(path) for path in paths)
    if not policies_empty:
        blockers.append("runtimePolicies")
    return {
        "ready": not blockers,
        "blockers": blockers,
        "sourceCount": int(verification.get("sourceCount") or 0),
        "verifiedCount": int(verification.get("verifiedCount") or 0),
        "policiesEmpty": policies_empty,
    }


def _decoded_payload(payload: Any) -> Any:
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError(f"runtime JSON parse failed: {error}") from error
    return payload


def _managed_disposition(source_key: str) -> tuple[str, str | None, str | None] | None:
    if source_key in FILE_EXACT_KEYS or source_key.startswith(files_migration.CONTENT_PREFIX):
        return (
            domain_migration.DISPOSITION_ALREADY_RELATIONAL_VERIFY,
            "files",
            None,
        )
    if source_key in QUESTION_EXACT_KEYS or source_key.startswith(QUESTION_PREFIXES):
        return (
            domain_migration.DISPOSITION_ALREADY_RELATIONAL_VERIFY,
            "question-catalog",
            None,
        )
    if source_key in DEVICE_PREFERENCE_EXACT_KEYS or source_key.startswith(
        DEVICE_PREFERENCE_PREFIXES
    ):
        return (
            domain_migration.DISPOSITION_UI_ONLY_DROP,
            None,
            "device-local preference; KGDevicePreferences is authoritative",
        )
    if source_key in DISPOSABLE_MARKERS:
        return (
            domain_migration.DISPOSITION_DEPRECATED_DROP,
            None,
            "one-time compatibility marker is retired",
        )
    return None


def _is_external_domain_key(source_key: str) -> bool:
    disposition = _managed_disposition(source_key)
    return bool(
        disposition
        and disposition[0] == domain_migration.DISPOSITION_ALREADY_RELATIONAL_VERIFY
    )


_DRAFT_METADATA = {
    "id",
    "ownerId",
    "name",
    "status",
    "revision",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt",
}


def _actor_identifier(value: Any) -> str:
    if isinstance(value, Mapping):
        value = value.get("username") or value.get("id")
    return str(value or "").strip()


def _source_owner(raw: Mapping[str, Any], fallback_owner: str) -> str:
    if fallback_owner and fallback_owner != "shared":
        return fallback_owner
    for candidate in (raw.get("ownerId"), raw.get("createdBy"), raw.get("updatedBy")):
        owner = _actor_identifier(candidate)
        if owner:
            return owner
    raise ValueError("shared course draft is missing a relational owner")


def _normalize_course_drafts(
    payload: Any, fallback_owner: str
) -> list[dict[str, Any]]:
    decoded = _decoded_payload(payload)
    if not isinstance(decoded, list):
        raise ValueError("course drafts source must be a list")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in decoded:
        if not isinstance(raw, Mapping):
            raise ValueError("course drafts source contains a non-object entry")
        identifier = str(raw.get("id") or "").strip()
        name = str(raw.get("name") or "").strip()
        explicit_structure = raw.get("structure")
        if explicit_structure is not None and not isinstance(explicit_structure, Mapping):
            raise ValueError("course draft structure must be an object")
        structure = (
            dict(explicit_structure)
            if isinstance(explicit_structure, Mapping)
            else {key: value for key, value in raw.items() if key not in _DRAFT_METADATA}
        )
        if not identifier or not name:
            raise ValueError("course draft is missing id or name")
        if identifier in seen:
            raise ValueError(f"duplicate course draft id: {identifier}")
        seen.add(identifier)
        status = str(raw.get("status") or "draft").strip()
        if status not in {"draft", "archived"}:
            raise ValueError(f"invalid course draft status: {status}")
        revision = int(raw.get("revision") or 1)
        if revision < 1:
            raise ValueError("course draft revision must be positive")
        normalized.append(
            {
                "id": identifier,
                "ownerId": _source_owner(raw, fallback_owner),
                "name": name,
                "structure": dict(structure),
                "revision": revision,
                "status": status,
            }
        )
    return normalized


def _course_draft_row(row: CourseDraft) -> dict[str, Any]:
    return {
        "id": row.id,
        "ownerId": row.owner_id,
        "name": row.name,
        "structure": dict(row.structure or {}),
        "revision": row.revision,
        "status": row.status,
    }


def _timestamp(value: Any, field: str) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"{field} is not a valid timestamp") from error
    raise ValueError(f"{field} is required")


def _normalize_course_releases(
    payload: Any, fallback_owner: str
) -> list[dict[str, Any]]:
    decoded = _decoded_payload(payload)
    if not isinstance(decoded, list):
        raise ValueError("course releases source must be a list")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in decoded:
        if not isinstance(raw, Mapping):
            raise ValueError("course releases source contains a non-object entry")
        identifier = str(raw.get("id") or raw.get("releaseId") or "").strip()
        snapshot = raw.get("course") or raw.get("courseSnapshot")
        if not identifier or not isinstance(snapshot, Mapping):
            raise ValueError("course release is missing id or course snapshot")
        if identifier in seen:
            raise ValueError(f"duplicate course release id: {identifier}")
        seen.add(identifier)
        course_id = str(
            raw.get("courseId") or snapshot.get("id") or raw.get("sourceDraftId") or ""
        ).strip()
        if not course_id:
            raise ValueError("course release is missing courseId")
        status = str(raw.get("status") or "published").strip()
        if status not in {"published", "superseded", "withdrawn"}:
            raise ValueError(f"invalid course release status: {status}")
        published_at = _timestamp(raw.get("publishedAt"), "publishedAt")
        withdrawn_at = (
            _timestamp(raw.get("withdrawnAt"), "withdrawnAt")
            if raw.get("withdrawnAt")
            else None
        )
        result.append(
            {
                "id": identifier,
                "ownerId": _source_owner(raw, fallback_owner),
                "courseId": course_id,
                "sourceDraftId": str(raw.get("sourceDraftId") or course_id),
                "sourceDraftRevision": max(
                    1, int(raw.get("sourceDraftRevision") or snapshot.get("revision") or 1)
                ),
                "version": max(1, int(raw.get("version") or 1)),
                "status": status,
                "course": dict(snapshot),
                "notes": str(raw.get("notes") or ""),
                "contentHash": canonical_hash(dict(snapshot)),
                "revision": max(1, int(raw.get("revision") or 1)),
                "publishedBy": _actor_identifier(raw.get("publishedBy"))
                or _source_owner(raw, fallback_owner),
                "publishedAt": published_at.isoformat(),
                "withdrawnBy": _actor_identifier(raw.get("withdrawnBy")) or None,
                "withdrawnAt": withdrawn_at.isoformat() if withdrawn_at else None,
            }
        )
    return result


def _course_release_row(row: CourseRelease) -> dict[str, Any]:
    return {
        "id": row.id,
        "ownerId": row.owner_id,
        "courseId": row.course_id,
        "sourceDraftId": row.source_draft_id,
        "sourceDraftRevision": row.source_draft_revision,
        "version": row.version,
        "status": row.status,
        "course": dict(row.course_snapshot or {}),
        "notes": row.notes,
        "contentHash": row.content_hash,
        "revision": row.revision,
        "publishedBy": row.published_by,
        "publishedAt": row.published_at.isoformat(),
        "withdrawnBy": row.withdrawn_by,
        "withdrawnAt": row.withdrawn_at.isoformat() if row.withdrawn_at else None,
    }


_TASK_METADATA = {
    "id",
    "ownerId",
    "releaseId",
    "title",
    "description",
    "audience",
    "status",
    "revision",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt",
    "content",
}


def _normalize_learning_tasks(
    payload: Any, fallback_owner: str
) -> list[dict[str, Any]]:
    decoded = _decoded_payload(payload)
    if not isinstance(decoded, list):
        raise ValueError("learning tasks source must be a list")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in decoded:
        if not isinstance(raw, Mapping):
            raise ValueError("learning tasks source contains a non-object entry")
        identifier = str(raw.get("id") or "").strip()
        release_id = str(raw.get("releaseId") or "").strip()
        title = str(raw.get("title") or raw.get("name") or "").strip()
        if not identifier or not release_id or not title:
            raise ValueError("learning task is missing id, releaseId, or title")
        if identifier in seen:
            raise ValueError(f"duplicate learning task id: {identifier}")
        seen.add(identifier)
        status = str(raw.get("status") or "draft").strip()
        if status not in {"draft", "published", "archived"}:
            raise ValueError(f"invalid learning task status: {status}")
        audience = raw.get("audience") or {}
        if not isinstance(audience, Mapping):
            raise ValueError("learning task audience must be an object")
        explicit_content = raw.get("content")
        if explicit_content is not None and not isinstance(explicit_content, Mapping):
            raise ValueError("learning task content must be an object")
        content = (
            dict(explicit_content)
            if isinstance(explicit_content, Mapping)
            else {key: value for key, value in raw.items() if key not in _TASK_METADATA}
        )
        owner = _source_owner(raw, fallback_owner)
        result.append(
            {
                "id": identifier,
                "ownerId": owner,
                "releaseId": release_id,
                "title": title,
                "description": str(raw.get("description") or ""),
                "audience": dict(audience),
                "content": content,
                "status": status,
                "revision": max(1, int(raw.get("revision") or 1)),
                "createdBy": _actor_identifier(raw.get("createdBy")) or owner,
                "updatedBy": _actor_identifier(raw.get("updatedBy")) or owner,
            }
        )
    return result


def _learning_task_row(row: LearningTask) -> dict[str, Any]:
    return {
        "id": row.id,
        "ownerId": row.owner_id,
        "releaseId": row.release_id,
        "title": row.title,
        "description": row.description,
        "audience": dict(row.audience or {}),
        "content": dict(row.content or {}),
        "status": row.status,
        "revision": row.revision,
        "createdBy": row.created_by,
        "updatedBy": row.updated_by,
    }


def _normalize_course_source(item: RuntimeMigrationItem) -> Any:
    if item.source_key == COURSE_DRAFTS_KEY:
        return _normalize_course_drafts(item.source_payload, item.owner_scope)
    if item.source_key == COURSE_RELEASES_KEY:
        return _normalize_course_releases(item.source_payload, item.owner_scope)
    if item.source_key == LEARNING_TASKS_KEY:
        return _normalize_learning_tasks(item.source_payload, item.owner_scope)
    if item.source_key == ACTIVE_COURSE_RELEASE_KEY:
        decoded = _decoded_payload(item.source_payload)
        if decoded in (None, {}, ""):
            return None
        if not isinstance(decoded, Mapping):
            raise ValueError("active course release source must be an object")
        release_id = str(decoded.get("releaseId") or decoded.get("id") or "").strip()
        if not release_id:
            raise ValueError("active course release is missing releaseId")
        return {"releaseId": release_id}
    raise ValueError("unsupported course source")


async def _prepare_course_items(db: AsyncSession, run_id: str) -> None:
    items = list(
        (
            await db.scalars(
                select(RuntimeMigrationItem).where(
                    RuntimeMigrationItem.run_id == run_id,
                    RuntimeMigrationItem.source_key.in_(COURSE_SOURCE_KEYS),
                )
            )
        ).all()
    )
    for item in items:
        item.disposition = domain_migration.DISPOSITION_MIGRATE
        item.target_domain = "course-management"
        item.discard_reason = None
        try:
            canonical = _normalize_course_source(item)
        except (TypeError, ValueError) as error:
            item.status = "failed"
            item.error = str(error)
            metadata = dict(item.verification_metadata or {})
            metadata["parse_error"] = True
            item.verification_metadata = metadata
            continue
        expected_count = domain_migration._payload_count(canonical)
        item.expected_count = expected_count
        item.expected_hash = canonical_hash(canonical)
        metadata = dict(item.verification_metadata or {})
        metadata.update(
            {
                "expected_count": expected_count,
                "expected_hash": item.expected_hash,
                "parse_error": False,
            }
        )
        item.verification_metadata = metadata
    await db.commit()


async def _prepare_managed_items(db: AsyncSession, run_id: str) -> None:
    items = await _items(db, run_id)
    for item in items:
        disposition = _managed_disposition(item.source_key)
        if disposition is None:
            continue
        item.disposition, item.target_domain, item.discard_reason = disposition
        item.expected_count = item.source_count
        item.expected_hash = item.source_hash
        if item.disposition in {
            domain_migration.DISPOSITION_UI_ONLY_DROP,
            domain_migration.DISPOSITION_DEPRECATED_DROP,
        }:
            item.target_count = item.source_count
            item.target_hash = item.source_hash
            item.status = "verified"
            item.error = None
    await db.commit()


def _model_report(report: Any) -> dict[str, Any]:
    return report.model_dump(by_alias=True) if hasattr(report, "model_dump") else dict(report)


def _external_summary(
    files: Mapping[str, Any], questions: Mapping[str, Any], papers: Mapping[str, Any]
) -> dict[str, Any]:
    question_conflicts = len(questions.get("conflicts") or [])
    paper_conflicts = len(papers.get("conflicts") or [])
    question_invalid = len(questions.get("invalidRecords") or [])
    paper_invalid = len(papers.get("invalidRecords") or [])
    null_content_hashes = int(questions.get("nullContentHashes") or 0)
    paper_integrity = sum(
        int(papers.get(key) or 0)
        for key in (
            "missingQuestionCount",
            "questionsWithMissingRefs",
            "missingCategoryCount",
            "referenceGaps",
            "scoreGaps",
        )
    )
    question_hash_mismatch = int(
        bool(questions.get("sourceHash"))
        and bool(questions.get("targetHash"))
        and questions.get("sourceHash") != questions.get("targetHash")
    )
    paper_hash_mismatch = int(
        bool(papers.get("sourceHash"))
        and bool(papers.get("targetHash"))
        and papers.get("sourceHash") != papers.get("targetHash")
    )
    return {
        "files": {
            "owners": int(files.get("owners") or 0),
            "files": int(files.get("files") or 0),
            "warnings": int(files.get("warnings") or 0),
            "failures": int(files.get("failures") or files.get("failedOwners") or 0),
            "verified": files.get("verified"),
            "sourceHash": files.get("sourceHash"),
            "targetHash": files.get("targetHash"),
            "verificationHash": files.get("verificationHash"),
        },
        "questions": {
            "inventoryHash": questions.get("snapshotHash"),
            "banks": int(questions.get("bankCount") or 0),
            "questions": int(questions.get("questionCount") or 0),
            "conflicts": question_conflicts,
            "invalid": question_invalid,
            "applied": bool(questions.get("applied")),
            "nullContentHashes": null_content_hashes,
            "verified": questions.get("verified"),
            "sourceHash": questions.get("sourceHash"),
            "targetHash": questions.get("targetHash"),
            "verificationHash": questions.get("verificationHash"),
        },
        "papers": {
            "inventoryHash": papers.get("snapshotHash"),
            "papers": int(papers.get("paperCount") or 0),
            "conflicts": paper_conflicts,
            "invalid": paper_invalid,
            "applied": bool(papers.get("applied")),
            "integrityErrors": paper_integrity,
            "verified": papers.get("verified"),
            "sourceHash": papers.get("sourceHash"),
            "targetHash": papers.get("targetHash"),
            "verificationHash": papers.get("verificationHash"),
        },
        "parseErrors": question_invalid + paper_invalid + int(files.get("warnings") or 0),
        "unresolvedConflicts": question_conflicts + paper_conflicts + paper_integrity,
        "hashMismatches": (
            int(files.get("failures") or files.get("failedOwners") or 0)
            + null_content_hashes
            + question_hash_mismatch
            + paper_hash_mismatch
        ),
    }


def _external_owner_ids(
    items: Iterable[RuntimeMigrationItem] | None,
) -> set[str] | None:
    item_rows = list(items or [])
    scoped_owners = {
        item.owner_scope
        for item in item_rows
        if _is_external_domain_key(item.source_key)
        and item.owner_scope not in {"", "shared"}
    }
    has_shared = any(
        _is_external_domain_key(item.source_key) and item.owner_scope == "shared"
        for item in item_rows
    )
    return None if not item_rows or has_shared else scoped_owners


async def _scan_external_domains(
    db: AsyncSession, items: Iterable[RuntimeMigrationItem] | None = None
) -> dict[str, Any]:
    owner_ids = _external_owner_ids(items)
    files = await files_migration.scan_all_graph_files(db)
    questions = _model_report(
        await question_migration.scan_runtime_question_sources(db, owner_ids=owner_ids)
    )
    papers = _model_report(
        await question_migration.scan_runtime_paper_sources(db, owner_ids=owner_ids)
    )
    return _external_summary(files, questions, papers)


async def _verify_external_domains(
    db: AsyncSession, items: Iterable[RuntimeMigrationItem]
) -> dict[str, Any]:
    item_rows = list(items)
    owner_ids = _external_owner_ids(item_rows)
    file_owners = sorted({
        item.owner_scope for item in item_rows
        if item.target_domain == "files" and item.owner_scope not in {"", "shared"}
    })
    files = await files_migration.verify_all_graph_files(db, owners=file_owners)
    questions = _model_report(
        await question_migration.scan_runtime_question_sources(db, owner_ids=owner_ids)
    )
    questions.update(
        await question_migration.verify_runtime_question_targets(db, owner_ids=owner_ids)
    )
    papers = _model_report(
        await question_migration.scan_runtime_paper_sources(db, owner_ids=owner_ids)
    )
    papers.update(
        await question_migration.verify_runtime_paper_targets(db, owner_ids=owner_ids)
    )
    return _external_summary(files, questions, papers)


async def _migrate_external_domains(db: AsyncSession) -> dict[str, Any]:
    files = await files_migration.migrate_all_graph_files(db)
    question_apply = _model_report(
        await question_migration.migrate_runtime_questions(db, apply=True)
    )
    actor = await db.get(User, "admin")
    if actor is None:
        paper_apply = {
            "snapshotHash": None,
            "paperCount": 0,
            "conflicts": [],
            "invalidRecords": [{"reason": "migration actor admin is missing"}],
            "applied": False,
        }
    else:
        paper_apply = _model_report(
            await question_migration.migrate_runtime_papers(db, actor=actor, apply=True)
        )
    questions = _model_report(await question_migration.scan_runtime_question_sources(db))
    questions["applied"] = bool(question_apply.get("applied"))
    questions.update(await question_migration.verify_runtime_question_targets(db))
    papers = _model_report(await question_migration.scan_runtime_paper_sources(db))
    papers["applied"] = bool(paper_apply.get("applied"))
    papers.update(await question_migration.verify_runtime_paper_targets(db))
    verification = await files_migration.verify_all_graph_files(db)
    files = {**files, **verification}
    return _external_summary(files, questions, papers)


async def _mark_external_items(
    db: AsyncSession,
    run_id: str,
    summary: Mapping[str, Any],
    *,
    commit: bool = True,
) -> None:
    items = await _items(db, run_id)
    file_ok = bool(summary.get("files", {}).get("verified"))
    question_ok = bool(summary.get("questions", {}).get("verified"))
    paper_ok = bool(summary.get("papers", {}).get("verified"))
    for item in items:
        disposition = _managed_disposition(item.source_key)
        if not disposition or disposition[0] != domain_migration.DISPOSITION_ALREADY_RELATIONAL_VERIFY:
            continue
        if item.target_domain == "files":
            ok = file_ok
            proof_hash = summary.get("files", {}).get("verificationHash")
        elif item.source_key.startswith(question_migration.PAPER_DRAFT_PREFIX) or item.source_key.startswith(question_migration.PAPER_CATEGORY_PREFIX) or item.source_key in {question_migration.PAPER_SHARED_DRAFT_KEY, question_migration.PAPER_SHARED_CATEGORY_KEY}:
            ok = paper_ok
            proof_hash = summary.get("papers", {}).get("verificationHash")
        else:
            ok = question_ok
            proof_hash = summary.get("questions", {}).get("verificationHash")
        if ok and proof_hash:
            item.status = "verified"
            item.target_count = item.expected_count
            item.expected_hash = str(proof_hash)
            item.target_hash = str(proof_hash)
            metadata = dict(item.verification_metadata or {})
            metadata["external_proof_hash"] = str(proof_hash)
            item.verification_metadata = metadata
            item.error = None
        else:
            item.status = "failed"
            item.error = "external domain verification failed"
    if commit:
        await db.commit()
    else:
        await db.flush()


def _item_metrics(items: list[RuntimeMigrationItem]) -> dict[str, int]:
    unresolved = 0
    for item in items:
        metadata = item.verification_metadata or {}
        unresolved += int(metadata.get("unresolved_conflicts") or 0)
    return {
        "sourceCount": len(items),
        "verifiedCount": sum(item.status == "verified" for item in items),
        "unknown": sum(item.disposition == domain_migration.DISPOSITION_UNKNOWN for item in items),
        "parseErrors": sum(bool((item.verification_metadata or {}).get("parse_error")) for item in items),
        "hashMismatches": sum(bool(item.error and "hash" in item.error.lower()) for item in items),
        "unresolvedConflicts": unresolved,
    }


async def _items(db: AsyncSession, run_id: str) -> list[RuntimeMigrationItem]:
    return list(
        (
            await db.scalars(
                select(RuntimeMigrationItem).where(RuntimeMigrationItem.run_id == run_id)
            )
        ).all()
    )


def _public_item_summaries(items: Iterable[RuntimeMigrationItem]) -> list[dict[str, Any]]:
    return [
        {
            "sourceType": item.source_type,
            "sourceKey": item.source_key,
            "ownerScope": item.owner_scope,
            "disposition": item.disposition,
            "targetDomain": item.target_domain,
            "sourceCount": item.source_count,
            "sourceHash": item.source_hash,
            "expectedCount": item.expected_count,
            "expectedHash": item.expected_hash,
            "targetCount": item.target_count,
            "targetHash": item.target_hash,
            "status": item.status,
        }
        for item in sorted(
            items, key=lambda row: (row.source_type, row.source_key, row.owner_scope, row.id)
        )
    ]


async def scan(
    db: AsyncSession,
    *,
    run_id: str = "runtime-retirement",
    sources: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a payload-free, read-only source inventory (no ledger writes)."""

    source_rows = list(sources) if sources is not None else await domain_migration._runtime_sources(db)
    public_items: list[dict[str, Any]] = []
    parse_errors = 0
    unknown = 0
    for source in source_rows:
        source_key = str(source.get("source_key") or "")
        source_type = str(source.get("source_type") or "runtime")
        owner_scope = str(source.get("owner_id") or source.get("owner_scope") or "")
        payload = source.get("payload")
        mapper = domain_migration._mapper_for_key(
            domain_migration.TARGET_MAPPER_REGISTRY, source_key
        )
        disposition, target_domain, discard_reason = domain_migration._disposition_for_key(
            source_key, mapper
        )
        managed = _managed_disposition(source_key)
        if managed is not None:
            disposition, target_domain, discard_reason = managed
        parse_error = source.get("parse_error")
        if source_key in COURSE_SOURCE_KEYS:
            disposition = domain_migration.DISPOSITION_MIGRATE
            target_domain = "course-management"
            discard_reason = None
            probe = RuntimeMigrationItem(
                id="read-only-probe",
                run_id=run_id,
                source_type=source_type,
                source_key=source_key,
                owner_scope=owner_scope,
                source_hash=canonical_hash(payload),
                source_payload=payload,
                disposition=disposition,
                required=bool(source.get("required", True)),
                source_count=domain_migration._payload_count(payload),
                target_count=0,
                status="pending",
            )
            try:
                _normalize_course_source(probe)
            except (TypeError, ValueError) as error:
                parse_error = str(error)
        if parse_error:
            parse_errors += 1
            discard_reason = str(parse_error)
        if disposition == domain_migration.DISPOSITION_UNKNOWN:
            unknown += 1
        public_items.append(
            {
                "sourceType": source_type,
                "sourceKey": source_key,
                "ownerScope": owner_scope,
                "disposition": disposition,
                "targetDomain": target_domain,
                "discardReason": discard_reason,
                "sourceCount": domain_migration._payload_count(payload),
                "sourceHash": canonical_hash(payload),
            }
        )
    snapshot_hash = canonical_hash(domain_migration._source_snapshot_payload(source_rows))
    report = {
        "run_id": run_id,
        "status": "planned",
        "writesExecuted": False,
        "sourceCount": len(public_items),
        "unknown": unknown,
        "parseErrors": parse_errors,
        "hashMismatches": 0,
        "unresolvedConflicts": 0,
        "sourceSnapshotHash": snapshot_hash,
        "items": public_items,
    }
    if sources is None:
        external = await _scan_external_domains(db)
        report["domains"] = {
            key: external[key] for key in ("files", "questions", "papers")
        }
        report["parseErrors"] += external["parseErrors"]
        report["unresolvedConflicts"] = external["unresolvedConflicts"]
        report["hashMismatches"] = external["hashMismatches"]
    return report


async def _ledger_scan(
    db: AsyncSession,
    *,
    run_id: str,
    sources: Iterable[Mapping[str, Any]] | None,
) -> dict[str, Any]:
    raw = await domain_migration.scan(db, run_id, sources=sources)
    await _prepare_course_items(db, run_id)
    await _prepare_managed_items(db, run_id)
    items = await _items(db, run_id)
    return {
        "run_id": run_id,
        "status": raw["status"],
        "created": raw["created"],
        "deduplicated": raw["deduplicated"],
        "sourceSnapshotHash": raw["source_snapshot_hash"],
        **_item_metrics(items),
    }


async def migrate(
    db: AsyncSession,
    *,
    run_id: str = "runtime-retirement",
    sources: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Migrate known sources; relational course rows always win conflicts."""

    scan_report = await _ledger_scan(db, run_id=run_id, sources=sources)
    counters = {"created": 0}

    async def course_draft_mapper(
        session: AsyncSession, item: RuntimeMigrationItem
    ) -> Mapping[str, Any]:
        sources_canonical = _normalize_course_drafts(item.source_payload, item.owner_scope)
        target: list[dict[str, Any]] = []
        conflicts: list[dict[str, Any]] = []
        for source in sources_canonical:
            row = await session.get(CourseDraft, source["id"])
            if row is None:
                row = CourseDraft(
                    id=source["id"],
                    owner_id=source["ownerId"],
                    name=source["name"],
                    structure=source["structure"],
                    revision=source["revision"],
                    status=source["status"],
                    created_by=source["ownerId"],
                    updated_by=source["ownerId"],
                )
                session.add(row)
                await session.flush()
                counters["created"] += 1
            actual = _course_draft_row(row)
            if actual != source:
                conflicts.append(
                    {
                        "id": source["id"],
                        "disposition": "domain-wins",
                        "sourceHash": canonical_hash(source),
                        "targetHash": canonical_hash(actual),
                    }
                )
            target.append(actual)
        metadata = dict(item.verification_metadata or {})
        metadata.update(
            {
                "unresolved_conflicts": len(conflicts),
                "conflicts": conflicts,
            }
        )
        item.verification_metadata = metadata
        return {"canonical_payload": target}

    async def course_release_mapper(
        session: AsyncSession, item: RuntimeMigrationItem
    ) -> Mapping[str, Any]:
        sources_canonical = _normalize_course_releases(item.source_payload, item.owner_scope)
        target: list[dict[str, Any]] = []
        conflicts: list[dict[str, Any]] = []
        for source in sources_canonical:
            row = await session.get(CourseRelease, source["id"])
            if row is None:
                row = CourseRelease(
                    id=source["id"],
                    owner_id=source["ownerId"],
                    course_id=source["courseId"],
                    source_draft_id=source["sourceDraftId"],
                    source_draft_revision=source["sourceDraftRevision"],
                    version=source["version"],
                    status=source["status"],
                    course_snapshot=source["course"],
                    notes=source["notes"],
                    content_hash=source["contentHash"],
                    revision=source["revision"],
                    published_by=source["publishedBy"],
                    published_at=_timestamp(source["publishedAt"], "publishedAt"),
                    withdrawn_by=source["withdrawnBy"],
                    withdrawn_at=(
                        _timestamp(source["withdrawnAt"], "withdrawnAt")
                        if source["withdrawnAt"]
                        else None
                    ),
                )
                session.add(row)
                await session.flush()
                counters["created"] += 1
            actual = _course_release_row(row)
            if actual != source:
                conflicts.append(
                    {
                        "id": source["id"],
                        "disposition": "domain-wins",
                        "sourceHash": canonical_hash(source),
                        "targetHash": canonical_hash(actual),
                    }
                )
            target.append(actual)
        metadata = dict(item.verification_metadata or {})
        metadata.update(
            {"unresolved_conflicts": len(conflicts), "conflicts": conflicts}
        )
        item.verification_metadata = metadata
        return {"canonical_payload": target}

    async def learning_task_mapper(
        session: AsyncSession, item: RuntimeMigrationItem
    ) -> Mapping[str, Any]:
        sources_canonical = _normalize_learning_tasks(item.source_payload, item.owner_scope)
        target: list[dict[str, Any]] = []
        conflicts: list[dict[str, Any]] = []
        for source in sources_canonical:
            row = await session.get(LearningTask, source["id"])
            if row is None:
                release = await session.get(CourseRelease, source["releaseId"])
                if release is None or release.owner_id != source["ownerId"]:
                    raise ValueError(
                        f"learning task release is missing or owned by another user: {source['releaseId']}"
                    )
                row = LearningTask(
                    id=source["id"],
                    owner_id=source["ownerId"],
                    release_id=source["releaseId"],
                    title=source["title"],
                    description=source["description"],
                    audience=source["audience"],
                    content=source["content"],
                    status=source["status"],
                    revision=source["revision"],
                    created_by=source["createdBy"],
                    updated_by=source["updatedBy"],
                )
                session.add(row)
                await session.flush()
                counters["created"] += 1
            actual = _learning_task_row(row)
            if actual != source:
                conflicts.append(
                    {
                        "id": source["id"],
                        "disposition": "domain-wins",
                        "sourceHash": canonical_hash(source),
                        "targetHash": canonical_hash(actual),
                    }
                )
            target.append(actual)
        metadata = dict(item.verification_metadata or {})
        metadata.update(
            {"unresolved_conflicts": len(conflicts), "conflicts": conflicts}
        )
        item.verification_metadata = metadata
        return {"canonical_payload": target}

    async def active_release_mapper(
        session: AsyncSession, item: RuntimeMigrationItem
    ) -> Mapping[str, Any]:
        source = _normalize_course_source(item)
        target = None
        if source is not None:
            release = await session.get(CourseRelease, source["releaseId"])
            if (
                release is not None
                and (item.owner_scope == "shared" or release.owner_id == item.owner_scope)
                and release.status == "published"
            ):
                target = {"releaseId": release.id}
        conflicts = [] if source == target else [{
            "id": source.get("releaseId") if isinstance(source, Mapping) else item.owner_scope,
            "disposition": "derived-domain-wins",
            "sourceHash": canonical_hash(source),
            "targetHash": canonical_hash(target),
        }]
        metadata = dict(item.verification_metadata or {})
        metadata.update({"unresolved_conflicts": len(conflicts), "conflicts": conflicts})
        item.verification_metadata = metadata
        return {"canonical_payload": target}

    registry = dict(domain_migration.TARGET_MAPPER_REGISTRY)
    registry[COURSE_DRAFTS_KEY] = course_draft_mapper
    registry[COURSE_RELEASES_KEY] = course_release_mapper
    registry[LEARNING_TASKS_KEY] = learning_task_mapper
    registry[ACTIVE_COURSE_RELEASE_KEY] = active_release_mapper
    applied = await domain_migration.migrate(db, run_id, target_mappers=registry)
    external = None
    if sources is None:
        external = await _migrate_external_domains(db)
        await _mark_external_items(db, run_id, external)
    else:
        current_items = await _items(db, run_id)
        if any(_is_external_domain_key(item.source_key) for item in current_items):
            external = await _verify_external_domains(db, current_items)
            await _mark_external_items(db, run_id, external)
    items = await _items(db, run_id)
    metrics = _item_metrics(items)
    if external is not None:
        metrics["parseErrors"] += external["parseErrors"]
        metrics["unresolvedConflicts"] += external["unresolvedConflicts"]
        metrics["hashMismatches"] += external["hashMismatches"]
    report = {
        "run_id": run_id,
        "status": applied["status"],
        "created": counters["created"],
        "deduplicated": scan_report["deduplicated"],
        "migrated": applied["migrated"],
        "pending": sum(item.required and item.status == "pending" for item in items),
        "sourceSnapshotHash": scan_report["sourceSnapshotHash"],
        "items": _public_item_summaries(items),
        **metrics,
    }
    if external is not None:
        report["domains"] = {
            key: external[key] for key in ("files", "questions", "papers")
        }
    return report


async def _refresh_course_target_hashes(
    db: AsyncSession, run_id: str, *, commit: bool = True
) -> None:
    items = await _items(db, run_id)
    for item in items:
        if item.source_key not in COURSE_SOURCE_KEYS:
            continue
        try:
            source = _normalize_course_source(item)
        except (TypeError, ValueError):
            continue
        if item.source_key == COURSE_DRAFTS_KEY:
            target = [
                _course_draft_row(row)
                for entry in source
                if (row := await db.get(CourseDraft, entry["id"])) is not None
            ]
        elif item.source_key == COURSE_RELEASES_KEY:
            target = [
                _course_release_row(row)
                for entry in source
                if (row := await db.get(CourseRelease, entry["id"])) is not None
            ]
        elif item.source_key == LEARNING_TASKS_KEY:
            target = [
                _learning_task_row(row)
                for entry in source
                if (row := await db.get(LearningTask, entry["id"])) is not None
            ]
        else:
            target = None
            if source is not None:
                row = await db.get(CourseRelease, source["releaseId"])
                if (
                    row is not None
                    and (item.owner_scope == "shared" or row.owner_id == item.owner_scope)
                    and row.status == "published"
                ):
                    target = {"releaseId": row.id}
        item.target_count = domain_migration._payload_count(target)
        item.target_hash = canonical_hash(target)
        metadata = dict(item.verification_metadata or {})
        conflicts: list[dict[str, Any]] = []
        if isinstance(source, list) and isinstance(target, list):
            target_by_id = {
                str(entry.get("id")): entry
                for entry in target
                if isinstance(entry, Mapping)
            }
            for entry in source:
                actual = target_by_id.get(str(entry.get("id")))
                if entry != actual:
                    conflicts.append(
                        {
                            "id": str(entry.get("id")),
                            "disposition": "domain-wins",
                            "sourceHash": canonical_hash(entry),
                            "targetHash": canonical_hash(actual),
                        }
                    )
        elif source != target:
            conflicts.append(
                {
                    "id": (
                        str(source.get("releaseId"))
                        if isinstance(source, Mapping)
                        else item.owner_scope
                    ),
                    "disposition": "derived-domain-wins",
                    "sourceHash": canonical_hash(source),
                    "targetHash": canonical_hash(target),
                }
            )
        metadata.update(
            {"unresolved_conflicts": len(conflicts), "conflicts": conflicts}
        )
        item.verification_metadata = metadata
        # A prior hash conflict is re-checkable after the domain row changes.
        item.status = "migrated"
        item.error = None
    if commit:
        await db.commit()
    else:
        await db.flush()


async def verify(
    db: AsyncSession,
    *,
    run_id: str = "runtime-retirement",
    _commit: bool = True,
) -> dict[str, Any]:
    """Re-read relational course targets before delegating ledger verification."""

    # PostgreSQL requires the isolation declaration to be the first statement
    # of the transaction.  One snapshot covers every external/course/domain
    # proof read; ledger statuses are committed only after all proofs finish.
    if db.in_transaction():
        await db.rollback()
    await db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
    try:
        items_before = await _items(db, run_id)
        external = None
        if any(_is_external_domain_key(item.source_key) for item in items_before):
            external = await _verify_external_domains(db, items_before)
        await _refresh_course_target_hashes(db, run_id, commit=False)
        if external is not None:
            await _mark_external_items(db, run_id, external, commit=False)
        raw = await domain_migration.verify(db, run_id, commit=False)
        items = await _items(db, run_id)
        if _commit:
            await db.commit()
        else:
            await db.flush()
    except Exception:
        await db.rollback()
        raise
    metrics = _item_metrics(items)
    # Domain verification uses precise per-item errors.  Expose them as
    # aggregate blockers, without serializing source or target values.
    metrics["hashMismatches"] = sum(
        bool(item.required and item.error and "hash" in item.error.lower())
        for item in items
    )
    if external is not None:
        metrics["parseErrors"] += external["parseErrors"]
        metrics["unresolvedConflicts"] += external["unresolvedConflicts"]
        metrics["hashMismatches"] += external["hashMismatches"]
    report = {
        "run_id": run_id,
        "status": raw["status"],
        "requiredFailures": int(raw["required_failures"]),
        "sourceSnapshotHash": raw.get("source_snapshot_hash"),
        "backupReference": raw.get("backup_reference"),
        "items": _public_item_summaries(items),
        **metrics,
    }
    if external is not None:
        report["domains"] = {
            key: external[key] for key in ("files", "questions", "papers")
        }
    return report


async def drop_check(
    db: AsyncSession,
    *,
    run_id: str = "runtime-retirement",
    policy_paths: Iterable[Path] = DEFAULT_POLICY_PATHS,
) -> dict[str, Any]:
    """Return the final read-only retirement gate; never execute DDL."""

    try:
        verification = await verify(db, run_id=run_id, _commit=False)
        # Source snapshot, target proofs, and ledger gate are observed in the
        # same REPEATABLE READ transaction.  No second ordinary verify occurs.
        ledger_allowed = await domain_migration.can_drop_runtime(db, run_id)
        gate = evaluate_drop_gate(verification, policy_paths=policy_paths)
        if not ledger_allowed and not gate["blockers"]:
            gate["blockers"].append("ledgerVerification")
            gate["ready"] = False
        report = {
            **verification,
            **gate,
            "run_id": run_id,
            "status": "ready" if gate["ready"] else "blocked",
            "ddlExecuted": False,
        }
        await db.commit()
        return report
    except Exception:
        await db.rollback()
        raise
