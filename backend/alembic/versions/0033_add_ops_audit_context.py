"""Add bounded operator audit context.

Revision ID: 0033_ops_audit_context
Revises: 0032_ops_audit_sanitize
Create Date: 2026-08-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0033_ops_audit_context"
down_revision: str | None = "0032_ops_audit_sanitize"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ops_audit_events", sa.Column("reason", sa.String(length=500), nullable=True))
    op.add_column("ops_audit_events", sa.Column("request_id", sa.String(length=128), nullable=True))
    op.add_column("ops_audit_events", sa.Column("peer_address", sa.String(length=64), nullable=True))
    op.add_column("ops_audit_events", sa.Column("previous_state", sa.String(length=128), nullable=True))
    op.add_column("ops_audit_events", sa.Column("new_state", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("ops_audit_events", "new_state")
    op.drop_column("ops_audit_events", "previous_state")
    op.drop_column("ops_audit_events", "peer_address")
    op.drop_column("ops_audit_events", "request_id")
    op.drop_column("ops_audit_events", "reason")
