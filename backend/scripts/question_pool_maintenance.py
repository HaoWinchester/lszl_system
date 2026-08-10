#!/usr/bin/env python3
"""Read-only maintenance entry point for the shared question pool."""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.schemas.question_cleanup import (  # noqa: E402
    QuestionCleanupReport,
    QuestionCleanupReviewDecisionFile,
)
from app.services.question_cleanup_service import (  # noqa: E402
    apply_review_decisions,
    build_report,
    calculate_manifest_hash,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect the shared question pool without changing business data.",
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


def _paths_alias(first: Path, second: Path) -> bool:
    if first.resolve() == second.resolve():
        return True
    try:
        return first.exists() and second.exists() and first.samefile(second)
    except OSError:
        return False


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
    raise ValueError(f"unsupported command: {args.command}")


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(run(parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
