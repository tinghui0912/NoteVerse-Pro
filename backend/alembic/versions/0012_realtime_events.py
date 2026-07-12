"""Add realtime events.

Revision ID: 0012_realtime_events
Revises: 0011_repeat_revision_content
Create Date: 2026-07-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012_realtime_events"
down_revision: Union[str, None] = "0011_repeat_revision_content"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "realtime_events",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("event_uuid", sa.String(length=36), nullable=False),
        sa.Column("recipient_user_id", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.String(length=96), nullable=False),
        sa.Column("resource_type", sa.String(length=40), nullable=True),
        sa.Column("resource_id", sa.String(length=128), nullable=True),
        sa.Column("score_id", sa.String(length=36), nullable=True),
        sa.Column("revision_id", sa.String(length=36), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_uuid"),
    )
    op.create_index(
        "idx_realtime_events_recipient_id",
        "realtime_events",
        ["recipient_user_id", "id"],
        unique=False,
    )
    op.create_index(
        "idx_realtime_events_recipient_created",
        "realtime_events",
        ["recipient_user_id", "created_at"],
        unique=False,
    )
    op.create_index("idx_realtime_events_score", "realtime_events", ["score_id"], unique=False)
    op.create_index("idx_realtime_events_type", "realtime_events", ["type"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_realtime_events_type", table_name="realtime_events")
    op.drop_index("idx_realtime_events_score", table_name="realtime_events")
    op.drop_index("idx_realtime_events_recipient_created", table_name="realtime_events")
    op.drop_index("idx_realtime_events_recipient_id", table_name="realtime_events")
    op.drop_table("realtime_events")
