"""补齐发布快照缺失的可编辑试卷数据（孤儿 release 物化 + 投影对账）。"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.services import paper_release_service


async def _run(dry_run: bool, reconcile_only: bool) -> dict:
    async with AsyncSessionLocal() as db:
        report = await paper_release_service.reconcile_active_paper_projections(db)
        materialized: dict = {"materialized": 0, "releases": [], "dryRun": dry_run}
        if not reconcile_only:
            materialized = await paper_release_service.materialize_release_papers(db, dry_run=dry_run)
        return {"repaired_paper_projections": report, **materialized}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="补齐发布快照缺失的可编辑试卷数据")
    parser.add_argument("--dry-run", action="store_true", help="只报告将要补建的发布版本，不写库")
    parser.add_argument("--reconcile-only", action="store_true", help="只修复试卷状态投影，不补建孤儿试卷")
    parser.add_argument("--report-json", default=None, help="把报告写入指定 JSON 文件")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    report = asyncio.run(_run(args.dry_run, args.reconcile_only))
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report_json:
        path = Path(args.report_json)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
