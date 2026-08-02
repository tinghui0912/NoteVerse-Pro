"""Store the resolved client address separately from the proxy peer.

Revision ID: 0034_ops_audit_client_address
Revises: 0033_ops_audit_context
Create Date: 2026-08-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0034_ops_audit_client_address"
down_revision: str | None = "0033_ops_audit_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ops_audit_events", sa.Column("client_address", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("ops_audit_events", "client_address")
