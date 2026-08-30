"""Unified Runtime State retirement migration command line interface."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.services import runtime_retirement_service


async def _run(command: str, run_id: str) -> dict:
    async with AsyncSessionLocal() as db:
        if command == "scan":
            return await runtime_retirement_service.scan(db, run_id=run_id)
        if command == "migrate":
            return await runtime_retirement_service.migrate(db, run_id=run_id)
        if command == "verify":
            return await runtime_retirement_service.verify(db, run_id=run_id)
        return await runtime_retirement_service.drop_check(db, run_id=run_id)


def report_exit_code(command: str, report: dict) -> int:
    if command == "drop-check" and not bool(report.get("ready")):
        return 2
    if command == "verify" and report.get("status") != "verified":
        return 2
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Runtime State retirement gate")
    parser.add_argument("command", choices=("scan", "migrate", "verify", "drop-check"))
    parser.add_argument("--run-id", default="runtime-retirement")
    parser.add_argument("--report-json", required=True)
    return parser


def write_report(path: Path, report: dict) -> str:
    safe = runtime_retirement_service.sanitize_public_report(report)
    rendered = json.dumps(safe, ensure_ascii=False, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered, encoding="utf-8")
    return rendered


def main() -> None:
    args = build_parser().parse_args()
    report = asyncio.run(_run(args.command, args.run_id))
    path = Path(args.report_json)
    rendered = write_report(path, report)
    print(rendered, end="")
    exit_code = report_exit_code(
        args.command, runtime_retirement_service.sanitize_public_report(report)
    )
    if exit_code:
        raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
