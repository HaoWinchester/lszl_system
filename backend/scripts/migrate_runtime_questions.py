#!/usr/bin/env python3
"""Dry-run or apply the Runtime State question catalog migration."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.services.question_migration_service import migrate_runtime_questions  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate Runtime State question banks into the relational catalog.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply only when the snapshot has no conflicts or invalid records.",
    )
    parser.add_argument("--report", type=Path, help="Write the JSON report to this path.")
    return parser.parse_args()


async def run(args: argparse.Namespace) -> int:
    async with AsyncSessionLocal() as db:
        report = await migrate_runtime_questions(db, apply=args.apply)
    payload = report.model_dump(by_alias=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    if args.apply and not report.applied:
        return 2
    return 0


def main() -> int:
    return asyncio.run(run(parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
