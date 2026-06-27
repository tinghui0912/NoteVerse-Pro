"""remove score bookmarks

Revision ID: fb2c3d4e5f6a
Revises: fa1b2c3d4e5f
Create Date: 2026-06-27 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "fb2c3d4e5f6a"
down_revision: Union[str, Sequence[str], None] = "fa1b2c3d4e5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("idx_score_bookmarks_user_created", table_name="score_bookmarks")
    op.drop_table("score_bookmarks")


def downgrade() -> None:
    op.create_table(
        "score_bookmarks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("score_id", "user_id", name="uq_score_bookmarks_score_user"),
    )
    op.create_index(
        "idx_score_bookmarks_user_created",
        "score_bookmarks",
        ["user_id", "created_at"],
    )