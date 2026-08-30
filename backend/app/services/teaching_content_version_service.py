"""Shared database-version boundaries for relational teaching content."""

from __future__ import annotations


DATABASE_INTEGER_MAX = 2_147_483_647


def validate_database_integer(
    value: object,
    label: str,
    *,
    minimum: int,
) -> int:
    """Return an INTEGER-safe value without relying on the database to reject it."""

    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < minimum
        or value > DATABASE_INTEGER_MAX
    ):
        raise ValueError(
            f"{label}必须是 {minimum} 到 {DATABASE_INTEGER_MAX} 之间的整数"
        )
    return value


def next_database_version(current: object, label: str) -> int:
    """Allocate the next INTEGER version, failing closed when the domain is full."""

    normalized = validate_database_integer(current, label, minimum=0)
    if normalized == DATABASE_INTEGER_MAX:
        raise ValueError(f"{label}已达到数据库上限，无法创建新版本")
    return normalized + 1
