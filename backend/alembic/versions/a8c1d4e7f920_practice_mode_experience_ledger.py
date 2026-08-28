"""Restore ordinary practice sessions and baseline trusted completed experience.

Revision ID: a8c1d4e7f920
Revises: f7a2c4e6b810
"""

from hashlib import sha256

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert

revision = "a8c1d4e7f920"
down_revision = "f7a2c4e6b810"
branch_labels = None
depends_on = None


def backfill_experience(bind):
    metadata = sa.MetaData()
    sessions = sa.Table("practice_sessions", metadata, autoload_with=bind)
    events = sa.Table("learning_events", metadata, autoload_with=bind)
    rows = bind.execute(
        sa.select(sessions).where(sessions.c.status == "completed")
    ).mappings().all()
    for row in rows:
        stats = dict(row["stats"] or {})
        if stats.get("experienceAccountingVersion") == 1:
            continue
        total = max(0, int(stats.get("experience") or 0))
        key = f"{row['owner_id']}:{row['id']}:{total}"
        if total:
            bind.execute(
                insert(events).values(
                    id="pxp_" + sha256(key.encode()).hexdigest()[:60],
                    owner_id=row["owner_id"],
                    question_id=None,
                    event_type="PRACTICE_EXPERIENCE_SETTLED",
                    created_at=row["completed_at"] or row["last_saved_at"],
                    payload={"sessionId": row["id"], "delta": total,
                             "totalExperience": total, "settlementKey": key},
                ).on_conflict_do_nothing(index_elements=["id"])
            )
        stats.update(creditedExperience=total, experienceAccountingVersion=1)
        bind.execute(
            sessions.update().where(sessions.c.id == row["id"]).values(stats=stats)
        )


def upgrade():
    op.drop_constraint("ck_practice_sessions_mode", "practice_sessions", type_="check")
    op.create_check_constraint(
        "ck_practice_sessions_mode", "practice_sessions",
        "mode IN ('challenge', 'scholar', 'revenge', 'practice')",
    )
    backfill_experience(op.get_bind())


def downgrade():
    if op.get_bind().execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM practice_sessions WHERE mode = 'practice')"
    )).scalar_one():
        raise RuntimeError("普通练习会话仍存在，不能缩小模式约束")
    op.drop_constraint("ck_practice_sessions_mode", "practice_sessions", type_="check")
    op.create_check_constraint(
        "ck_practice_sessions_mode", "practice_sessions",
        "mode IN ('challenge', 'scholar', 'revenge')",
    )
    # Credited experience is not erased by a schema rollback.
