"""图谱 files runtime 全量迁移命令行入口。"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.services.files_runtime_migration_service import (
    drop_check_all_graph_files,
    migrate_all_graph_files,
    scan_all_graph_files,
    verify_all_graph_files,
)


async def _run(command: str) -> dict:
    async with AsyncSessionLocal() as db:
        if command == "scan":
            return await scan_all_graph_files(db)
        if command == "migrate":
            return await migrate_all_graph_files(db)
        if command == "verify":
            return await verify_all_graph_files(db)
        return await drop_check_all_graph_files(db)


def report_exit_code(command: str, report: dict) -> int:
    if command == "migrate" and int(report.get("failedOwners") or 0) > 0:
        return 1
    if command == "verify" and not report.get("verified", False):
        return 1
    if command == "drop-check" and not report.get("safeToDrop", False):
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="图谱 files runtime 全量迁移")
    parser.add_argument("command", choices=("scan", "migrate", "verify", "drop-check"))
    parser.add_argument("--report-json")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    report = asyncio.run(_run(args.command))
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    print(rendered, end="")
    if args.report_json:
        path = Path(args.report_json)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered, encoding="utf-8")
    exit_code = report_exit_code(args.command, report)
    if exit_code:
        raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
