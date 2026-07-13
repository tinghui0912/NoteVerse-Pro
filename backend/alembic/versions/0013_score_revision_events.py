"""Add score revision events.

Revision ID: 0013_score_revision_events
Revises: 0012_realtime_events
Create Date: 2026-07-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0013_score_revision_events"
down_revision: Union[str, None] = "0012_realtime_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "score_revision_events",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("event_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("target_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["target_revision_id"], ["score_revisions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_uuid"),
    )
    op.create_index(
        "idx_score_revision_events_score_created",
        "score_revision_events",
        ["score_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_score_revision_events_revision",
        "score_revision_events",
        ["revision_id"],
        unique=False,
    )
    op.create_index(
        "idx_score_revision_events_target_revision",
        "score_revision_events",
        ["target_revision_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_score_revision_events_target_revision", table_name="score_revision_events")
    op.drop_index("idx_score_revision_events_revision", table_name="score_revision_events")
    op.drop_index("idx_score_revision_events_score_created", table_name="score_revision_events")
    op.drop_table("score_revision_events")
