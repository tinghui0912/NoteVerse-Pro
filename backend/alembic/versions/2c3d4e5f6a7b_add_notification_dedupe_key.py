"""Add notification dedupe key.

Revision ID: 2c3d4e5f6a7b
Revises: 1b2c3d4e5f6a
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "2c3d4e5f6a7b"
down_revision: str | Sequence[str] | None = "1b2c3d4e5f6a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notification_events",
        sa.Column("dedupe_key", sa.String(length=160), nullable=True),
    )
    op.create_index(
        "uq_notification_events_dedupe_key",
        "notification_events",
        ["dedupe_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_notification_events_dedupe_key", table_name="notification_events")
    op.drop_column("notification_events", "dedupe_key")
