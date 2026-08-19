"""Runtime state 领域迁移命令行入口。"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.services.runtime_domain_migration_service import drop_check, migrate, plan, scan, verify


async def _run(command: str, run_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        if command == "plan":
            return await plan(db)
        if command == "scan":
            return await scan(db, run_id=run_id)
        if command in {"apply", "dry-run"}:
            if command == "dry-run":
                report = await plan(db)
                return {**report, "status": "dry_run", "writes_executed": False}
            return await migrate(db, run_id)
        if command == "drop-check":
            return await drop_check(db, run_id)
        return await verify(db, run_id)


def report_exit_code(command: str, report: dict) -> int:
    if command in {"verify", "drop-check"} and (
        report.get("status") not in {"verified", "drop_allowed"}
        or int(report.get("required_failures") or 0) > 0
        or int(report.get("unknown") or 0) > 0
    ):
        return 1
    if command == "scan" and int(report.get("items") or 0) == 0:
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Runtime state 领域迁移")
    parser.add_argument("command", choices=("plan", "scan", "dry-run", "apply", "verify", "drop-check"))
    parser.add_argument("--run-id", default="runtime-domain-migration")
    parser.add_argument("--report-json", required=True)
    args = parser.parse_args()

    report = asyncio.run(_run(args.command, args.run_id))
    path = Path(args.report_json)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(report_exit_code(args.command, report))


if __name__ == "__main__":
    main()
