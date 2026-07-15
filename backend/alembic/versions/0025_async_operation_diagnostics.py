"""Add async operation diagnostics.

Revision ID: 0025_async_operation_diagnostics
Revises: 0024_ops_audit_events
Create Date: 2026-07-15 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0025_async_operation_diagnostics"
down_revision: str | None = "0024_ops_audit_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "import_jobs",
    "render_outbox",
    "playback_outbox",
    "mail_outbox",
    "scores",
)


def upgrade() -> None:
    for table_name in TABLES:
        op.add_column(table_name, sa.Column("internal_error_code", sa.String(length=128), nullable=True))
        op.add_column(table_name, sa.Column("internal_error_stage", sa.String(length=64), nullable=True))
        op.add_column(table_name, sa.Column("internal_error_retryable", sa.Boolean(), nullable=True))


def downgrade() -> None:
    for table_name in reversed(TABLES):
        op.drop_column(table_name, "internal_error_retryable")
        op.drop_column(table_name, "internal_error_stage")
        op.drop_column(table_name, "internal_error_code")
