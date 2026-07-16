"""Add originating request IDs to async operations.

Revision ID: 0027_async_op_request_id
Revises: 0026_async_operation_error_class
Create Date: 2026-07-16 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0027_async_op_request_id"
down_revision: str | None = "0026_async_operation_error_class"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "import_jobs",
    "render_outbox",
    "playback_outbox",
    "mail_outbox",
)


def upgrade() -> None:
    for table_name in TABLES:
        op.add_column(
            table_name,
            sa.Column("originating_request_id", sa.String(length=64), nullable=True),
        )
        op.create_index(
            f"ix_{table_name}_originating_request_id",
            table_name,
            ["originating_request_id"],
        )
    op.add_column("scores", sa.Column("deletion_request_id", sa.String(length=64), nullable=True))
    op.create_index("idx_scores_deletion_request_id", "scores", ["deletion_request_id"])


def downgrade() -> None:
    op.drop_index("idx_scores_deletion_request_id", table_name="scores")
    op.drop_column("scores", "deletion_request_id")
    for table_name in reversed(TABLES):
        op.drop_index(f"ix_{table_name}_originating_request_id", table_name=table_name)
        op.drop_column(table_name, "originating_request_id")
