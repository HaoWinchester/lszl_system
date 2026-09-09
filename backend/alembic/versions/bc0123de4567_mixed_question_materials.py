"""Mixed paper types and immutable materials/assets."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = 'bc0123de4567'
down_revision = 'ab9012cd3456'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("practice_verifications", sa.Column("selected_pairs", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    for table in ('exam_papers', 'paper_releases'):
        name = f'ck_{table}_paper_type'
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, "paper_type IN ('standard', 'multiple_choice', 'mixed')")
    op.create_table('question_assets',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_id', sa.String(64), sa.ForeignKey('users.username'), nullable=False),
        sa.Column('filename', sa.String(200), nullable=False), sa.Column('mime_type', sa.String(32), nullable=False),
        sa.Column('alt', sa.String(1000), nullable=False), sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_question_assets_owner_id', 'question_assets', ['owner_id'])
    op.create_table('question_materials',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('owner_id', sa.String(64), sa.ForeignKey('users.username'), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False), sa.Column('title', sa.String(200), nullable=False),
        sa.Column('text', sa.Text(), nullable=False), sa.Column('images', postgresql.JSONB(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_question_materials_owner_id', 'question_materials', ['owner_id'])
    op.create_table('question_material_revisions',
        sa.Column('material_id', sa.String(64), sa.ForeignKey('question_materials.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('revision', sa.Integer(), primary_key=True),
        sa.Column('snapshot', postgresql.JSONB(), nullable=False))


def downgrade():
    op.drop_column("practice_verifications", "selected_pairs")
    op.drop_table('question_material_revisions')
    op.drop_table('question_materials')
    op.drop_table('question_assets')
    # Fail rather than silently discard mixed papers during a downgrade.
    for table in ('exam_papers', 'paper_releases'):
        name = f'ck_{table}_paper_type'
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, "paper_type IN ('standard', 'multiple_choice')")
