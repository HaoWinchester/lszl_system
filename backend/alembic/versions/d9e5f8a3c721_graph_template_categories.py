"""Persistent library categories; preserve publication IDs, versions and payloads.

Revision ID: d9e5f8a3c721
Revises: c8d4e7f2b610
"""
from alembic import op
import sqlalchemy as sa

revision = 'd9e5f8a3c721'
down_revision = 'c8d4e7f2b610'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('graph_templates', sa.Column('category', sa.String(16), nullable=False, server_default='general'))
    op.create_check_constraint('ck_graph_templates_category', 'graph_templates',
        "category IN ('pmp', 'prince2', 'cspm', 'gaoxiang', 'general')")
    # Match the authored package's stable source identity, never a display title.
    # Source owner/status and publication visibility are otherwise left untouched.
    op.execute(sa.text("""
        UPDATE graph_templates AS template SET category = 'pmp'
        WHERE EXISTS (
            SELECT 1 FROM graph_template_versions AS version
            JOIN graph_files AS source ON source.id = version.source_file_id
                AND source.owner_id = template.owner_id
            WHERE version.template_id = template.id
                AND version.version = template.current_version
                AND source.source = 'builtin-template'
                AND (source.source_file_id LIKE 'pmp8-knowledge-graphs-20261025:%'
                    OR version.graph_data -> 'meta' ->> 'contentPackageId' = 'pmp8-knowledge-graphs-20261025')
        )
    """))


def downgrade():
    op.drop_constraint('ck_graph_templates_category', 'graph_templates', type_='check')
    op.drop_column('graph_templates', 'category')
