"""add durable revision render outbox

Revision ID: 0002_revision_render_outbox
Revises: 0001_initial_schema
Create Date: 2026-07-06
"""

from datetime import datetime, timezone
from typing import Sequence
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "0002_revision_render_outbox"
down_revision: str | Sequence[str] | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "revision_render_outbox",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("render_profile", sa.String(length=128), nullable=False),
        sa.Column(
            "status",
            sa.Enum("PENDING", "DISPATCHED", "PROCESSING", "COMPLETED", "FAILED", name="renderoutboxstatus"),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("attempt_count >= 0", name="ck_render_outbox_attempt_count"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_uuid"),
        sa.UniqueConstraint("revision_id", "render_profile", name="uq_render_outbox_revision_profile"),
    )
    op.create_index(
        "idx_render_outbox_status_available",
        "revision_render_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    outbox = sa.table(
        "revision_render_outbox",
        sa.column("outbox_uuid", sa.String()),
        sa.column("score_id", sa.BigInteger()),
        sa.column("revision_id", sa.BigInteger()),
        sa.column("requested_by_user_id", sa.BigInteger()),
        sa.column("render_profile", sa.String()),
        sa.column("status", sa.String()),
        sa.column("attempt_count", sa.Integer()),
        sa.column("next_attempt_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    rows = op.get_bind().execute(
        sa.text(
            """
            SELECT s.id AS score_id, s.head_revision_id AS revision_id, s.owner_user_id AS user_id
            FROM scores s
            WHERE s.head_revision_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM score_artifacts a
                WHERE a.revision_id = s.head_revision_id
                  AND a.kind = 'RENDERED_PAGE'
              )
            """
        )
    ).mappings().all()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if rows:
        op.bulk_insert(
            outbox,
            [
                {
                    "outbox_uuid": str(uuid.uuid4()),
                    "score_id": row["score_id"],
                    "revision_id": row["revision_id"],
                    "requested_by_user_id": row["user_id"],
                    "render_profile": "default",
                    "status": "PENDING",
                    "attempt_count": 0,
                    "next_attempt_at": now,
                    "created_at": now,
                    "updated_at": now,
                }
                for row in rows
            ],
        )
    op.create_index(
        "idx_render_outbox_dispatched",
        "revision_render_outbox",
        ["status", "dispatched_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_render_outbox_dispatched", table_name="revision_render_outbox")
    op.drop_index("idx_render_outbox_status_available", table_name="revision_render_outbox")
    op.drop_table("revision_render_outbox")
    sa.Enum(name="renderoutboxstatus").drop(op.get_bind(), checkfirst=True)
