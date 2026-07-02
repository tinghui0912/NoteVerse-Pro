"""Add notification events.

Revision ID: 1b2c3d4e5f6a
Revises: 0a1b2c3d4e5f
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "1b2c3d4e5f6a"
down_revision: str | Sequence[str] | None = "0a1b2c3d4e5f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("notification_uuid", sa.String(length=36), nullable=False),
        sa.Column("recipient_user_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("type", sa.String(length=80), nullable=False),
        sa.Column("resource_type", sa.String(length=40), nullable=False),
        sa.Column("resource_id", sa.String(length=128), nullable=True),
        sa.Column("score_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.String(length=1024), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("notification_uuid"),
    )
    op.create_index(
        "idx_notification_events_recipient_created",
        "notification_events",
        ["recipient_user_id", "created_at"],
    )
    op.create_index(
        "idx_notification_events_recipient_read",
        "notification_events",
        ["recipient_user_id", "read_at"],
    )
    op.create_index(
        "idx_notification_events_resource",
        "notification_events",
        ["resource_type", "resource_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_notification_events_resource", table_name="notification_events")
    op.drop_index("idx_notification_events_recipient_read", table_name="notification_events")
    op.drop_index("idx_notification_events_recipient_created", table_name="notification_events")
    op.drop_table("notification_events")
