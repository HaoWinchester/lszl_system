"""Runtime state 领域迁移命令行入口。"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.services.runtime_domain_migration_service import migrate, scan, verify


async def _run(command: str, run_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        if command == "scan":
            return await scan(db, run_id=run_id)
        if command == "apply":
            return await migrate(db, run_id)
        return await verify(db, run_id)


def report_exit_code(command: str, report: dict) -> int:
    if command == "verify" and (
        report.get("status") != "verified" or int(report.get("required_failures") or 0) > 0
    ):
        return 1
    if command == "scan" and int(report.get("items") or 0) == 0:
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Runtime state 领域迁移")
    parser.add_argument("command", choices=("scan", "apply", "verify"))
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
