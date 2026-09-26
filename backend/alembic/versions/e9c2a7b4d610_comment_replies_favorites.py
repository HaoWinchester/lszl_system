"""Add nullable replies and private comment favorites without changing existing comments."""
from alembic import op
import sqlalchemy as sa
revision = "e9c2a7b4d610"
down_revision = "d9a8b7c6e502"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("question_comments", sa.Column("parent_id", sa.String(64), nullable=True))
    op.create_foreign_key("fk_question_comments_parent", "question_comments", "question_comments", ["parent_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_question_comments_parent_id", "question_comments", ["parent_id"])
    op.create_table("question_comment_favorites", sa.Column("comment_id", sa.String(64), sa.ForeignKey("question_comments.id", ondelete="CASCADE"), primary_key=True), sa.Column("owner_id", sa.String(64), sa.ForeignKey("users.username", ondelete="CASCADE"), primary_key=True), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))

def downgrade():
    op.drop_table("question_comment_favorites")
    op.drop_index("ix_question_comments_parent_id", table_name="question_comments")
    op.drop_constraint("fk_question_comments_parent", "question_comments", type_="foreignkey")
    op.drop_column("question_comments", "parent_id")
