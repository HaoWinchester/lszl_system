"""Runtime state 领域迁移命令行入口。"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.services.runtime_domain_migration_service import drop_check, migrate, plan, scan, verify


async def _run(command: str, run_id: str, source_keys: set[str] | None = None) -> dict:
    async with AsyncSessionLocal() as db:
        if command == "plan":
            return await plan(db, source_keys=source_keys)
        if command == "scan":
            return await scan(db, run_id=run_id, source_keys=source_keys)
        if command == "backfill":
            # A deploy may reuse its stable run id after the compatibility
            # runtime source has changed.  Always freeze the current source
            # snapshot; scan's source-hash upsert keeps unchanged reruns cheap.
            scanned = await scan(db, run_id=run_id, source_keys=source_keys)
            applied = await migrate(db, run_id)
            # Backfill is incremental: previously verified ledger entries are
            # audit history and may legitimately diverge after domain writes.
            # Explicit `verify` / `drop-check` still recheck verified entries.
            verified = await verify(db, run_id, recheck_verified=False)
            return {
                **verified,
                "scan": scanned,
                "apply": applied,
                "reused_existing_scan": bool(
                    int(scanned.get("created") or 0) == 0
                    and int(scanned.get("deduplicated") or 0) > 0
                ),
            }
        if command in {"apply", "dry-run"}:
            if command == "dry-run":
                report = await plan(db, source_keys=source_keys)
                return {**report, "status": "dry_run", "writes_executed": False}
            return await migrate(db, run_id)
        if command == "drop-check":
            return await drop_check(db, run_id)
        return await verify(db, run_id)


def report_exit_code(command: str, report: dict) -> int:
    if command in {"verify", "drop-check", "backfill"} and (
        report.get("status") not in {"verified", "drop_allowed"}
        or int(report.get("required_failures") or 0) > 0
        or int(report.get("unknown") or 0) > 0
    ):
        return 1
    if command == "scan" and int(report.get("items") or 0) == 0:
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Runtime state 领域迁移")
    parser.add_argument(
        "command",
        choices=("plan", "scan", "dry-run", "apply", "verify", "drop-check", "backfill"),
    )
    parser.add_argument("--run-id", default="runtime-domain-migration")
    parser.add_argument("--report-json", required=True)
    parser.add_argument(
        "--source-key",
        dest="source_keys",
        action="append",
        default=None,
        help="仅扫描指定 runtime 键；可重复传入",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()

    source_keys = set(args.source_keys) if args.source_keys is not None else None
    report = asyncio.run(_run(args.command, args.run_id, source_keys))
    path = Path(args.report_json)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(report_exit_code(args.command, report))


if __name__ == "__main__":
    main()
