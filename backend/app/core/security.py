"""密码 hash（bcrypt）与通用工具。

不使用 passlib（其在 Python 3.11 + bcrypt 4.x 有 __about__ 兼容问题），直接用 bcrypt。
"""

import uuid
from datetime import datetime, timezone

import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex}"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
