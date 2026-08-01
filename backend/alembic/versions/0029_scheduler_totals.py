"""Add cumulative scheduler metric counters.

Revision ID: 0029_scheduler_totals
Revises: 0028_scheduler_heartbeats
Create Date: 2026-07-30 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0029_scheduler_totals"
down_revision: str | None = "0028_scheduler_heartbeats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "scheduler_heartbeats",
        sa.Column("total_duration_ms", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "scheduler_heartbeats",
        sa.Column("total_due_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "scheduler_heartbeats",
        sa.Column("total_dispatched_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("scheduler_heartbeats", "total_dispatched_count")
    op.drop_column("scheduler_heartbeats", "total_due_count")
    op.drop_column("scheduler_heartbeats", "total_duration_ms")
