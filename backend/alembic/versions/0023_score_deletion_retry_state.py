"""Add score deletion cleanup retry state.

Revision ID: 0023_score_deletion_retry_state
Revises: 0022_score_deletion_status
Create Date: 2026-07-14 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0023_score_deletion_retry_state"
down_revision: str | None = "0022_score_deletion_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "scores",
        sa.Column(
            "cleanup_attempt_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column("scores", sa.Column("next_cleanup_at", sa.DateTime(), nullable=True))
    op.add_column("scores", sa.Column("deletion_error", sa.Text(), nullable=True))
    op.create_index(
        "idx_scores_deletion_cleanup_due",
        "scores",
        ["deletion_status", "next_cleanup_at", "deletion_requested_at"],
    )
    op.alter_column("scores", "cleanup_attempt_count", server_default=None)


def downgrade() -> None:
    op.drop_index("idx_scores_deletion_cleanup_due", table_name="scores")
    op.drop_column("scores", "deletion_error")
    op.drop_column("scores", "next_cleanup_at")
    op.drop_column("scores", "cleanup_attempt_count")
