"""Add dedicated Beat leader observability state.

Revision ID: 0031_scheduler_leader_status
Revises: 0030_scheduler_lock_metrics
Create Date: 2026-08-01 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0031_scheduler_leader_status"
down_revision: str | None = "0030_scheduler_lock_metrics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scheduler_leader_statuses",
        sa.Column("scheduler_name", sa.String(length=80), nullable=False),
        sa.Column("last_acquired_at", sa.DateTime(), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("last_standby_at", sa.DateTime(), nullable=True),
        sa.Column("last_child_exit_at", sa.DateTime(), nullable=True),
        sa.Column("acquired_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("standby_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("child_exit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("scheduler_name"),
    )
    # The previous implementation used a synthetic scheduler heartbeat row.
    # Remove it now that leader and scan semantics have distinct storage.
    op.execute("delete from scheduler_heartbeats where job_key = 'beat_leader'")


def downgrade() -> None:
    op.drop_table("scheduler_leader_statuses")
