"""启动种子账号回归测试。"""

import asyncio
from sqlalchemy import select

from app.core.security import verify_password
from app.db.session import AsyncSessionLocal
from app.main import _seed_admin
from app.models.user import User


def test_seed_creates_requested_role_accounts_idempotently() -> None:
    expected = {
        "佩奇007": "admin",
        "老师": "teacher",
        "学生": "student",
        "乔治008": "viewer",
    }

    async def seed_and_read() -> tuple[dict[str, str], bool, bool]:
        await _seed_admin()
        await _seed_admin()
        async with AsyncSessionLocal() as db:
            users = (
                await db.execute(select(User).where(User.username.in_(expected)))
            ).scalars().all()
        return (
            {user.username: user.role for user in users},
            len(users) == 4 and all(user.status == "active" for user in users),
            len(users) == 4 and all(verify_password("111111", user.password_hash) for user in users),
        )

    roles, statuses_active, passwords_valid = asyncio.run(seed_and_read())
    assert roles == expected
    assert statuses_active
    assert passwords_valid
