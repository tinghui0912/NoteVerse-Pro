"""Remove raw diagnostic text from operator audit events.

Revision ID: 0032_ops_audit_sanitize
Revises: 0031_scheduler_leader_status
Create Date: 2026-08-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0032_ops_audit_sanitize"
down_revision: str | None = "0031_scheduler_leader_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("ops_audit_events", "error_detail")


def downgrade() -> None:
    op.add_column("ops_audit_events", sa.Column("error_detail", sa.Text(), nullable=True))
