"""add activity resource ownership

Revision ID: e2c6f8a1b304
Revises: d1a4c7e9f205
"""

from alembic import op
import sqlalchemy as sa


revision = "e2c6f8a1b304"
down_revision = "d1a4c7e9f205"
branch_labels = None
depends_on = None


TABLES = ("activity_collections", "activity_tags", "activity_overrides")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("owner_username", sa.String(64), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_owner_username_users",
            table,
            "users",
            ["owner_username"],
            ["username"],
            ondelete="SET NULL",
        )
        op.create_index(f"ix_{table}_owner_username", table, ["owner_username"])

    op.execute(
        """
        UPDATE activity_collections AS collection
        SET owner_username = candidate.username
        FROM users AS candidate
        WHERE collection.content_metadata ->> 'systemNamespace' IS NULL
          AND candidate.username = collection.content_metadata #>> '{authorship,createdByUserId}'
        """
    )

    op.execute(
        """
        UPDATE activity_tags AS tag
        SET content_metadata = jsonb_set(
            coalesce(tag.content_metadata, '{}'::jsonb),
            '{subjectId}',
            to_jsonb(collection.subject_id),
            true
        )
        FROM activity_collections AS collection
        WHERE collection.id = tag.collection_id
          AND coalesce(tag.content_metadata ->> 'subjectId', '') = ''
        """
    )
    op.execute(
        """
        UPDATE activity_overrides AS activity
        SET record = jsonb_set(
            jsonb_set(
                coalesce(activity.record, '{}'::jsonb),
                '{metadata}',
                coalesce(activity.record -> 'metadata', '{}'::jsonb),
                true
            ),
            '{metadata,subjectId}',
            to_jsonb(collection.subject_id),
            true
        )
        FROM activity_collections AS collection
        WHERE collection.id = activity.collection_id
          AND coalesce(activity.record #>> '{metadata,subjectId}', '') = ''
        """
    )

    op.execute(
        """
        INSERT INTO activity_collections
            (id, subject_id, title, status, content_metadata, owner_username)
        SELECT DISTINCT
            '__tags__:' || left(tag.content_metadata ->> 'subjectId', 70) || ':' ||
                md5(tag.collection_id || ':' || (tag.content_metadata ->> 'subjectId')),
            tag.content_metadata ->> 'subjectId',
            '历史标签命名空间',
            'active',
            jsonb_build_object(
                'systemNamespace', 'tags',
                'legacySourceCollectionId', tag.collection_id
            ),
            NULL
        FROM activity_tags AS tag
        JOIN activity_collections AS collection ON collection.id = tag.collection_id
        JOIN content_subjects AS subject
          ON subject.id = tag.content_metadata ->> 'subjectId'
        WHERE coalesce(tag.content_metadata ->> 'subjectId', '') <> ''
          AND tag.content_metadata ->> 'subjectId' <> collection.subject_id
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE activity_tags AS tag
        SET collection_id = '__tags__:' || left(tag.content_metadata ->> 'subjectId', 70) || ':' ||
            md5(tag.collection_id || ':' || (tag.content_metadata ->> 'subjectId'))
        FROM activity_collections AS collection
        WHERE collection.id = tag.collection_id
          AND coalesce(tag.content_metadata ->> 'subjectId', '') <> ''
          AND tag.content_metadata ->> 'subjectId' <> collection.subject_id
        """
    )

    op.execute(
        """
        INSERT INTO activity_collections
            (id, subject_id, title, status, content_metadata, owner_username)
        SELECT DISTINCT
            '__activities__:' || left(activity.record #>> '{metadata,subjectId}', 64) || ':' ||
                md5(activity.collection_id || ':' || (activity.record #>> '{metadata,subjectId}')),
            activity.record #>> '{metadata,subjectId}',
            '历史活动命名空间',
            'active',
            jsonb_build_object(
                'systemNamespace', 'activities',
                'legacySourceCollectionId', activity.collection_id
            ),
            NULL
        FROM activity_overrides AS activity
        JOIN activity_collections AS collection ON collection.id = activity.collection_id
        JOIN content_subjects AS subject
          ON subject.id = activity.record #>> '{metadata,subjectId}'
        WHERE coalesce(activity.record #>> '{metadata,subjectId}', '') <> ''
          AND activity.record #>> '{metadata,subjectId}' <> collection.subject_id
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE activity_overrides AS activity
        SET collection_id = '__activities__:' || left(activity.record #>> '{metadata,subjectId}', 64) || ':' ||
            md5(activity.collection_id || ':' || (activity.record #>> '{metadata,subjectId}'))
        FROM activity_collections AS collection
        WHERE collection.id = activity.collection_id
          AND coalesce(activity.record #>> '{metadata,subjectId}', '') <> ''
          AND activity.record #>> '{metadata,subjectId}' <> collection.subject_id
        """
    )

    op.execute(
        """
        UPDATE activity_tags AS tag
        SET owner_username = collection.owner_username
        FROM activity_collections AS collection
        WHERE collection.id = tag.collection_id
          AND collection.content_metadata ->> 'systemNamespace' IS NULL
        """
    )
    op.execute(
        """
        UPDATE activity_overrides AS activity
        SET owner_username = collection.owner_username
        FROM activity_collections AS collection
        WHERE collection.id = activity.collection_id
          AND collection.content_metadata ->> 'systemNamespace' IS NULL
        """
    )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_index(f"ix_{table}_owner_username", table_name=table)
        op.drop_constraint(
            f"fk_{table}_owner_username_users", table, type_="foreignkey"
        )
        op.drop_column(table, "owner_username")
