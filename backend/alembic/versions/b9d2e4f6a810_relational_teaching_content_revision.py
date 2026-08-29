"""Store the teaching-content revision in a dedicated relational singleton.

Revision ID: b9d2e4f6a810
Revises: c8e4f1a2b930
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "b9d2e4f6a810"
down_revision = "c8e4f1a2b930"
branch_labels = None
depends_on = None

REVISION_KEY = "kg_teaching_content_revision_v1"
MAX_CHANGES = 100


def _normalize_changes(changes: Any) -> list[dict[str, str]]:
    if not isinstance(changes, list):
        return []
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for change in changes:
        if not isinstance(change, dict):
            continue
        identity = (
            change.get("entityType"),
            change.get("entityId"),
            change.get("action"),
        )
        if not all(isinstance(value, str) and value for value in identity):
            continue
        if identity in seen:
            continue
        seen.add(identity)
        normalized.append(
            {
                "entityType": identity[0],
                "entityId": identity[1],
                "action": identity[2],
            }
        )
        if len(normalized) == MAX_CHANGES:
            break
    return normalized


def _parse_updated_at(value: Any, fallback: datetime | None) -> datetime | None:
    if not isinstance(value, str):
        return fallback
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return fallback
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def _legacy_values(bind: sa.Connection) -> dict[str, Any]:
    legacy = bind.execute(
        sa.text(
            """
            SELECT value, updated_by, updated_at
            FROM shared_runtime_states
            WHERE key = :key
            """
        ),
        {"key": REVISION_KEY},
    ).mappings().first()
    if legacy is None:
        return {"id": 1, "revision": 0, "changes": [], "updated_by": None}
    try:
        payload = json.loads(legacy["value"])
    except (TypeError, ValueError):
        payload = None
    if not isinstance(payload, dict):
        return {"id": 1, "revision": 0, "changes": [], "updated_by": None}

    legacy_revision = payload.get("revision")
    parsed_revision = (
        legacy_revision
        if isinstance(legacy_revision, int)
        and not isinstance(legacy_revision, bool)
        and legacy_revision >= 0
        else 0
    )
    updated_by = payload.get("updatedBy")
    values: dict[str, Any] = {
        "id": 1,
        "revision": parsed_revision,
        "changes": _normalize_changes(payload.get("changes")),
        "updated_by": (
            updated_by if isinstance(updated_by, str) else legacy["updated_by"]
        ),
    }
    updated_at = _parse_updated_at(payload.get("updatedAt"), legacy["updated_at"])
    if updated_at is not None:
        values["updated_at"] = updated_at
    return values


def upgrade() -> None:
    revisions = op.create_table(
        "teaching_content_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "changes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "id = 1",
            name="ck_teaching_content_revision_singleton",
        ),
    )
    op.bulk_insert(revisions, [_legacy_values(op.get_bind())])


def downgrade() -> None:
    op.drop_table("teaching_content_revisions")
