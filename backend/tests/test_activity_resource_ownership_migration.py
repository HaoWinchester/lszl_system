from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from sqlalchemy import text

from app.db.session import AsyncSessionLocal


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PREVIOUS_REVISION = "d1a4c7e9f205"


def _alembic(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_ROOT,
        env=dict(os.environ),
        check=True,
        capture_output=True,
        text=True,
    )


async def _owner_columns() -> set[tuple[str, str]]:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT table_name, column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name IN ('activity_collections', 'activity_tags', 'activity_overrides')
                      AND column_name = 'owner_username'
                    """
                )
            )
        ).all()
        return {(str(row[0]), str(row[1])) for row in rows}


def test_activity_resource_owner_migration_backfills_and_repairs_non_pmp_namespaces() -> None:
    suffix = uuid4().hex[:10]
    subject_id = f"subject-owner-migration-{suffix}"
    collection_id = f"collection-owner-migration-{suffix}"
    tag_id = f"tag-owner-migration-{suffix}"
    activity_id = f"activity-owner-migration-{suffix}"
    derived_collection_id = f"collection-derived-subject-{suffix}"
    derived_tag_id = f"tag-derived-subject-{suffix}"
    derived_activity_id = f"activity-derived-subject-{suffix}"

    async def seed_previous() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                text(
                    "INSERT INTO content_subjects (id, code, name, status, content_metadata) "
                    "VALUES (:id, :code, 'Owner migration', 'active', '{}'::jsonb)"
                ),
                {"id": subject_id, "code": f"OWN-{suffix}"},
            )
            await db.execute(
                text(
                    "INSERT INTO activity_collections (id, subject_id, title, status, content_metadata) "
                    "VALUES (:id, :subject, 'Derived subject', 'active', CAST(:metadata AS jsonb))"
                ),
                {
                    "id": derived_collection_id,
                    "subject": subject_id,
                    "metadata": json.dumps(
                        {"visibility": "shared", "authorship": {"createdByUserId": "admin"}}
                    ),
                },
            )
            await db.execute(
                text(
                    "INSERT INTO activity_collections (id, subject_id, title, status, content_metadata) "
                    "VALUES (:id, 'subject-pmp', 'Legacy owner', 'active', CAST(:metadata AS jsonb))"
                ),
                {
                    "id": collection_id,
                    "metadata": json.dumps(
                        {
                            "visibility": "shared",
                            "authorship": {"createdByUserId": "admin"},
                        }
                    ),
                },
            )
            await db.execute(
                text(
                    "INSERT INTO activity_tags (id, collection_id, tag, content_metadata) "
                    "VALUES (:id, :collection, 'Derived tag', '{}'::jsonb)"
                ),
                {"id": derived_tag_id, "collection": derived_collection_id},
            )
            await db.execute(
                text(
                    "INSERT INTO activity_tags (id, collection_id, tag, content_metadata) "
                    "VALUES (:id, :collection, 'Legacy tag', CAST(:metadata AS jsonb))"
                ),
                {
                    "id": tag_id,
                    "collection": collection_id,
                    "metadata": json.dumps({"subjectId": subject_id}),
                },
            )
            await db.execute(
                text(
                    "INSERT INTO activity_overrides (id, collection_id, activity_id, record, revision, updated_by) "
                    "VALUES (:id, :collection, :activity, CAST(:record AS jsonb), 1, 'admin')"
                ),
                {
                    "id": f"derived-row-{suffix}",
                    "collection": derived_collection_id,
                    "activity": derived_activity_id,
                    "record": json.dumps({"id": derived_activity_id, "metadata": {}}),
                },
            )
            await db.execute(
                text(
                    "INSERT INTO activity_overrides (id, collection_id, activity_id, record, revision, updated_by) "
                    "VALUES (:id, :collection, :activity, CAST(:record AS jsonb), 1, 'admin')"
                ),
                {
                    "id": f"row-{suffix}",
                    "collection": collection_id,
                    "activity": activity_id,
                    "record": json.dumps(
                        {"id": activity_id, "metadata": {"subjectId": subject_id}}
                    ),
                },
            )
            await db.commit()

    async def verify() -> None:
        async with AsyncSessionLocal() as db:
            collection = (
                await db.execute(
                    text(
                        "SELECT owner_username FROM activity_collections WHERE id=:id"
                    ),
                    {"id": collection_id},
                )
            ).one()
            tag = (
                await db.execute(
                    text(
                        "SELECT collection_id, owner_username FROM activity_tags WHERE id=:id"
                    ),
                    {"id": tag_id},
                )
            ).one()
            activity = (
                await db.execute(
                    text(
                        "SELECT collection_id, owner_username FROM activity_overrides WHERE activity_id=:id"
                    ),
                    {"id": activity_id},
                )
            ).one()
            assert collection.owner_username == "admin"
            assert tag.collection_id.startswith(f"__tags__:{subject_id}:")
            assert tag.owner_username is None
            assert activity.collection_id.startswith(f"__activities__:{subject_id}:")
            assert activity.owner_username is None
            derived_tag = (
                await db.execute(
                    text(
                        "SELECT content_metadata ->> 'subjectId' AS subject_id, owner_username "
                        "FROM activity_tags WHERE id=:id"
                    ),
                    {"id": derived_tag_id},
                )
            ).one()
            derived_activity = (
                await db.execute(
                    text(
                        "SELECT record #>> '{metadata,subjectId}' AS subject_id, owner_username "
                        "FROM activity_overrides WHERE activity_id=:id"
                    ),
                    {"id": derived_activity_id},
                )
            ).one()
            assert derived_tag.subject_id == subject_id
            assert derived_tag.owner_username == "admin"
            assert derived_activity.subject_id == subject_id
            assert derived_activity.owner_username == "admin"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("DELETE FROM activity_overrides WHERE activity_id IN (:first, :second)"),
                {"first": activity_id, "second": derived_activity_id},
            )
            await db.execute(
                text("DELETE FROM activity_tags WHERE id IN (:first, :second)"),
                {"first": tag_id, "second": derived_tag_id},
            )
            await db.execute(
                text(
                    "DELETE FROM activity_collections WHERE id IN (:id, :derived) OR id LIKE :tag_ns OR id LIKE :activity_ns"
                ),
                {
                    "id": collection_id,
                    "derived": derived_collection_id,
                    "tag_ns": f"__tags__:{subject_id}:%",
                    "activity_ns": f"__activities__:{subject_id}:%",
                },
            )
            await db.execute(text("DELETE FROM content_subjects WHERE id=:id"), {"id": subject_id})
            await db.commit()

    async def verify_downgrade_restores_collection_shape() -> None:
        async with AsyncSessionLocal() as db:
            tag_collection = await db.scalar(
                text("SELECT collection_id FROM activity_tags WHERE id=:id"),
                {"id": tag_id},
            )
            activity_collection = await db.scalar(
                text(
                    "SELECT collection_id FROM activity_overrides WHERE activity_id=:id"
                ),
                {"id": activity_id},
            )
            namespace_count = await db.scalar(
                text(
                    "SELECT count(*) FROM activity_collections "
                    "WHERE id LIKE :tag_ns OR id LIKE :activity_ns"
                ),
                {
                    "tag_ns": f"__tags__:{subject_id}:%",
                    "activity_ns": f"__activities__:{subject_id}:%",
                },
            )
            assert tag_collection == collection_id
            assert activity_collection == collection_id
            assert int(namespace_count or 0) == 0

    try:
        _alembic("upgrade", "head")
        _alembic("downgrade", PREVIOUS_REVISION)
        asyncio.run(seed_previous())
        _alembic("upgrade", "head")
        assert asyncio.run(_owner_columns()) == {
            ("activity_collections", "owner_username"),
            ("activity_tags", "owner_username"),
            ("activity_overrides", "owner_username"),
        }
        asyncio.run(verify())
        _alembic("downgrade", PREVIOUS_REVISION)
        asyncio.run(verify_downgrade_restores_collection_shape())
        offline = _alembic("upgrade", f"{PREVIOUS_REVISION}:head", "--sql").stdout
        assert offline.count("ADD COLUMN owner_username") == 3
        assert "FOREIGN KEY(owner_username) REFERENCES users (username)" in offline
    finally:
        _alembic("upgrade", "head")
        asyncio.run(cleanup())
