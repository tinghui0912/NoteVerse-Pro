"""Add async operation error class.

Revision ID: 0026_async_operation_error_class
Revises: 0025_async_operation_diagnostics
Create Date: 2026-07-15 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0026_async_operation_error_class"
down_revision: str | None = "0025_async_operation_diagnostics"
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
        op.add_column(table_name, sa.Column("internal_error_class", sa.String(length=32), nullable=True))


def downgrade() -> None:
    for table_name in reversed(TABLES):
        op.drop_column(table_name, "internal_error_class")
