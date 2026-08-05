"""Persist W3C creation context for durable asynchronous work.

Revision ID: 0036_async_trace_context
Revises: 0035_control_plane_identity
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0036_async_trace_context"
down_revision: str | None = "0035_control_plane_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = ("import_jobs", "render_outbox", "playback_outbox", "mail_outbox")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("traceparent", sa.String(length=55), nullable=True))
        op.add_column(table, sa.Column("tracestate", sa.String(length=512), nullable=True))


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_column(table, "tracestate")
        op.drop_column(table, "traceparent")
