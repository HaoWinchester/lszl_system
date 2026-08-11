#!/usr/bin/env python3
"""Preview or apply the guarded current teaching-content reset."""

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
from app.models.user import ADMIN, User  # noqa: E402
from app.services.teaching_content_reset_service import (  # noqa: E402
    CONFIRM_PREFIX,
    preview_reset,
    reset_current_content,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="受保护地预览或清空当前题库、题目、原则与归纳卡。",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("preview", help="只读输出当前清空范围和确认令牌。")
    apply = subcommands.add_parser("apply", help="用精确快照和确认令牌执行清空。")
    apply.add_argument("--actor", required=True, help="必须是现有管理员账号。")
    apply.add_argument("--snapshot-hash", required=True, help="preview 输出的完整 SHA-256。")
    apply.add_argument(
        "--confirm",
        required=True,
        help="preview 输出的 RESET-TEACHING-CONTENT:<hash前12位>。",
    )
    return parser.parse_args(argv)


def _print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


async def _run_preview() -> None:
    async with AsyncSessionLocal() as db:
        result = await preview_reset(db)
        _print_json(result)


async def _run_apply(args: argparse.Namespace) -> None:
    snapshot_hash = str(args.snapshot_hash or "").strip().lower()
    expected_token = f"{CONFIRM_PREFIX}:{snapshot_hash[:12]}"
    if args.confirm != expected_token:
        raise ValueError("确认令牌不匹配，请重新运行 preview")

    async with AsyncSessionLocal() as db:
        actor = await db.get(User, str(args.actor or "").strip())
        if actor is None:
            raise ValueError("操作者账号不存在")
        if actor.role != ADMIN:
            raise PermissionError("只有管理员可以执行教学内容清空")
        result = await reset_current_content(
            db,
            actor_username=actor.username,
            expected_snapshot_hash=snapshot_hash,
        )
        _print_json(result)


async def _run(args: argparse.Namespace) -> None:
    if args.command == "preview":
        await _run_preview()
        return
    await _run_apply(args)


def main(argv: list[str] | None = None) -> int:
    try:
        asyncio.run(_run(parse_args(argv)))
    except (PermissionError, RuntimeError, ValueError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
