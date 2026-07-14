"""Add ops audit events.

Revision ID: 0024_ops_audit_events
Revises: 0023_score_deletion_retry_state
Create Date: 2026-07-14 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0024_ops_audit_events"
down_revision: str | None = "0023_score_deletion_retry_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ops_audit_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("event_uuid", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("operation_kind", sa.String(length=40), nullable=False),
        sa.Column("operation_id", sa.String(length=128), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_uuid"),
    )
    op.create_index(
        "idx_ops_audit_events_action_created",
        "ops_audit_events",
        ["action", "created_at"],
    )
    op.create_index(
        "idx_ops_audit_events_actor_created",
        "ops_audit_events",
        ["actor_user_id", "created_at"],
    )
    op.create_index(
        "idx_ops_audit_events_operation",
        "ops_audit_events",
        ["operation_kind", "operation_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_ops_audit_events_operation", table_name="ops_audit_events")
    op.drop_index("idx_ops_audit_events_actor_created", table_name="ops_audit_events")
    op.drop_index("idx_ops_audit_events_action_created", table_name="ops_audit_events")
    op.drop_table("ops_audit_events")
