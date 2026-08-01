"""Add scheduler lock metrics.

Revision ID: 0030_scheduler_lock_metrics
Revises: 0029_scheduler_totals
Create Date: 2026-08-01 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0030_scheduler_lock_metrics"
down_revision: str | None = "0029_scheduler_totals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "scheduler_heartbeats",
        sa.Column("lock_acquired_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "scheduler_heartbeats",
        sa.Column("lock_skipped_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "scheduler_heartbeats",
        sa.Column("last_lock_skipped_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scheduler_heartbeats", "last_lock_skipped_at")
    op.drop_column("scheduler_heartbeats", "lock_skipped_count")
    op.drop_column("scheduler_heartbeats", "lock_acquired_count")
