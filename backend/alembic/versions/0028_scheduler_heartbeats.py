"""Add scheduler heartbeat metrics.

Revision ID: 0028_scheduler_heartbeats
Revises: 0027_async_op_request_id
Create Date: 2026-07-30 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0028_scheduler_heartbeats"
down_revision: str | None = "0027_async_op_request_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scheduler_heartbeats",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("job_key", sa.String(length=80), nullable=False),
        sa.Column("last_started_at", sa.DateTime(), nullable=True),
        sa.Column("last_success_at", sa.DateTime(), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(), nullable=True),
        sa.Column("last_duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_due_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_dispatched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_scheduler_heartbeats_job_key",
        "scheduler_heartbeats",
        ["job_key"],
        unique=True,
    )
    op.create_index(
        "idx_scheduler_heartbeats_last_success",
        "scheduler_heartbeats",
        ["last_success_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_scheduler_heartbeats_last_success", table_name="scheduler_heartbeats")
    op.drop_index("idx_scheduler_heartbeats_job_key", table_name="scheduler_heartbeats")
    op.drop_table("scheduler_heartbeats")
