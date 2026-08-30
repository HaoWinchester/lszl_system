"""Store the teaching-content revision in a dedicated relational singleton.

Revision ID: b9d2e4f6a810
Revises: c8e4f1a2b930
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "b9d2e4f6a810"
down_revision = "c8e4f1a2b930"
branch_labels = None
depends_on = None

LEGACY_REVISION_KEY = "kg_teaching_content_revision_v1"


DEFAULT_INSERT_SQL = """
INSERT INTO public.teaching_content_revisions (id, revision, changes, updated_by)
VALUES (1, 0, '[]'::jsonb, NULL)
"""

BACKFILL_SQL = f"""
DO $teaching_revision_backfill$
DECLARE
    legacy_table regclass := to_regclass('public.shared_runtime_states');
    legacy_value text;
    legacy_updated_by varchar(64);
    legacy_updated_at timestamptz;
    payload jsonb;
    parsed_revision integer := 0;
    parsed_changes jsonb := '[]'::jsonb;
    parsed_updated_by varchar(64);
    parsed_updated_at timestamptz;
BEGIN
    IF legacy_table IS NULL THEN
        RETURN;
    END IF;

    BEGIN
        EXECUTE format(
            'SELECT value, updated_by, updated_at FROM %s WHERE key = $1',
            legacy_table
        )
        INTO legacy_value, legacy_updated_by, legacy_updated_at
        USING '{LEGACY_REVISION_KEY}';
    EXCEPTION WHEN OTHERS THEN
        RETURN;
    END;

    IF legacy_value IS NULL THEN
        RETURN;
    END IF;

    BEGIN
        payload := legacy_value::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RETURN;
    END;

    IF jsonb_typeof(payload) <> 'object' THEN
        RETURN;
    END IF;

    IF jsonb_typeof(payload -> 'revision') = 'number'
       AND payload ->> 'revision' ~ '^[0-9]+$' THEN
        BEGIN
            parsed_revision := (payload ->> 'revision')::integer;
        EXCEPTION WHEN OTHERS THEN
            parsed_revision := 0;
        END;
    END IF;

    IF jsonb_typeof(payload -> 'changes') = 'array' THEN
        SELECT COALESCE(
            jsonb_agg(normalized ORDER BY first_ordinal),
            '[]'::jsonb
        )
        INTO parsed_changes
        FROM (
            SELECT
                jsonb_build_object(
                    'entityType', item ->> 'entityType',
                    'entityId', item ->> 'entityId',
                    'action', item ->> 'action'
                ) AS normalized,
                min(ordinality) AS first_ordinal
            FROM jsonb_array_elements(payload -> 'changes')
                WITH ORDINALITY AS entries(item, ordinality)
            WHERE jsonb_typeof(item) = 'object'
              AND jsonb_typeof(item -> 'entityType') = 'string'
              AND jsonb_typeof(item -> 'entityId') = 'string'
              AND jsonb_typeof(item -> 'action') = 'string'
              AND item ->> 'entityType' <> ''
              AND item ->> 'entityId' <> ''
              AND item ->> 'action' <> ''
            GROUP BY
                item ->> 'entityType',
                item ->> 'entityId',
                item ->> 'action'
            ORDER BY min(ordinality)
            LIMIT 100
        ) AS normalized_changes;
    END IF;

    parsed_updated_by := CASE
        WHEN jsonb_typeof(payload -> 'updatedBy') = 'string'
         AND char_length(payload ->> 'updatedBy') <= 64
        THEN payload ->> 'updatedBy'
        ELSE legacy_updated_by
    END;
    parsed_updated_at := legacy_updated_at;
    IF jsonb_typeof(payload -> 'updatedAt') = 'string' THEN
        BEGIN
            parsed_updated_at := (payload ->> 'updatedAt')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            parsed_updated_at := legacy_updated_at;
        END;
    END IF;

    UPDATE public.teaching_content_revisions
    SET revision = parsed_revision,
        changes = parsed_changes,
        updated_by = parsed_updated_by,
        updated_at = COALESCE(parsed_updated_at, now())
    WHERE id = 1;
END
$teaching_revision_backfill$;
"""


def upgrade() -> None:
    op.create_table(
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
        schema="public",
    )
    op.execute(DEFAULT_INSERT_SQL)
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.drop_table("teaching_content_revisions", schema="public")
