#!/usr/bin/env python3
"""Read-only maintenance entry point for the shared question pool."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.services.question_cleanup_service import build_report  # noqa: E402


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
    return parser.parse_args(argv)


async def run_report(output: Path) -> int:
    async with AsyncSessionLocal() as db:
        report = await build_report(db)

    payload = report.model_dump(mode="json", by_alias=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
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


async def run(args: argparse.Namespace) -> int:
    if args.command == "report":
        return await run_report(args.output)
    raise ValueError(f"unsupported command: {args.command}")


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(run(parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
