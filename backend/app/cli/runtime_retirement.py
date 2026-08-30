"""Unified Runtime State retirement migration command line interface."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.services import runtime_retirement_service


async def _run(command: str, run_id: str | None) -> dict:
    async with AsyncSessionLocal() as db:
        if command == "scan":
            return await runtime_retirement_service.scan(
                db, run_id=run_id or "runtime-retirement-scan"
            )
        if command == "migrate":
            return await runtime_retirement_service.migrate(db, run_id=run_id)
        if command == "verify":
            return await runtime_retirement_service.verify(db, run_id=run_id)
        return await runtime_retirement_service.drop_check(db, run_id=run_id)


def report_exit_code(command: str, report: dict) -> int:
    blocker_fields = (
        "unknown",
        "parseErrors",
        "hashMismatches",
        "unresolvedConflicts",
        "inventoryDrift",
        "requiredFailures",
        "pending",
    )
    if any(int(report.get(field) or 0) > 0 for field in blocker_fields):
        return 2
    if command == "drop-check" and not bool(report.get("ready")):
        return 2
    clean_statuses = {
        "scan": {"planned"},
        "migrate": {"applied"},
        "verify": {"verified"},
        "drop-check": {"ready"},
    }
    if report.get("status") not in clean_statuses[command]:
        return 2
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Runtime State retirement gate")
    commands = parser.add_subparsers(dest="command", required=True)
    scan_parser = commands.add_parser("scan")
    scan_parser.add_argument("--run-id")
    scan_parser.add_argument("--report-json", required=True)
    for command in ("migrate", "verify", "drop-check"):
        command_parser = commands.add_parser(command)
        command_parser.add_argument("--run-id", required=True)
        command_parser.add_argument("--report-json", required=True)
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
