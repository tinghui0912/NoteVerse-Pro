"""Add score revision notes.

Revision ID: 0014_score_revision_notes
Revises: 0013_score_revision_events
Create Date: 2026-07-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0014_score_revision_notes"
down_revision: Union[str, None] = "0013_score_revision_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "score_revision_notes",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("author_user_id", sa.BigInteger(), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("revision_id", name="uq_score_revision_notes_revision"),
    )
    op.create_index(
        "idx_score_revision_notes_score_updated",
        "score_revision_notes",
        ["score_id", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_score_revision_notes_score_updated", table_name="score_revision_notes")
    op.drop_table("score_revision_notes")
