"""playback assets and outbox

Revision ID: 0010_playback_assets
Revises: 0009_email_change_requests
Create Date: 2026-07-11 00:00:00.000000

"""

import uuid
from datetime import datetime
from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0010_playback_assets"
down_revision: str | Sequence[str] | None = "0009_email_change_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    sa.Enum("AUDIO", name="playbackassetkind").create(bind, checkfirst=True)
    sa.Enum(
        "PENDING",
        "DISPATCHED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        name="playbackoutboxstatus",
    ).create(bind, checkfirst=True)
    playback_asset_kind = postgresql.ENUM(
        "AUDIO",
        name="playbackassetkind",
        create_type=False,
    )
    playback_outbox_status = postgresql.ENUM(
        "PENDING",
        "DISPATCHED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        name="playbackoutboxstatus",
        create_type=False,
    )

    op.create_table(
        "score_playback_assets",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("asset_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", playback_asset_kind, nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("storage_key", sa.String(length=768), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("generator", sa.String(length=64), nullable=False),
        sa.Column("generator_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_uuid"),
        sa.UniqueConstraint("storage_key", name="uq_score_playback_assets_storage_key"),
        sa.UniqueConstraint(
            "revision_id",
            "kind",
            name="uq_score_playback_assets_revision_kind",
        ),
    )
    op.create_index(
        "idx_score_playback_assets_revision_kind",
        "score_playback_assets",
        ["revision_id", "kind"],
        unique=False,
    )

    op.create_table(
        "playback_outbox",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("asset_kind", playback_asset_kind, nullable=False),
        sa.Column("status", playback_outbox_status, nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("attempt_count >= 0", name="ck_playback_outbox_attempt_count"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_uuid"),
        sa.UniqueConstraint(
            "revision_id",
            "asset_kind",
            name="uq_playback_outbox_revision_kind",
        ),
    )
    op.create_index(
        "idx_playback_outbox_dispatched",
        "playback_outbox",
        ["status", "dispatched_at"],
        unique=False,
    )
    op.create_index(
        "idx_playback_outbox_status_available",
        "playback_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    _enqueue_existing_revisions()


def downgrade() -> None:
    op.drop_index("idx_playback_outbox_status_available", table_name="playback_outbox")
    op.drop_index("idx_playback_outbox_dispatched", table_name="playback_outbox")
    op.drop_table("playback_outbox")
    op.drop_index(
        "idx_score_playback_assets_revision_kind",
        table_name="score_playback_assets",
    )
    op.drop_table("score_playback_assets")
    sa.Enum(name="playbackoutboxstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="playbackassetkind").drop(op.get_bind(), checkfirst=True)


def _enqueue_existing_revisions() -> None:
    bind = op.get_bind()
    now = datetime.utcnow()
    rows = bind.execute(
        sa.text(
            """
            SELECT
                revisions.id AS revision_id,
                revisions.score_id AS score_id,
                revisions.content_hash AS source_fingerprint,
                COALESCE(revisions.created_by_user_id, scores.owner_user_id) AS user_id
            FROM score_revisions AS revisions
            JOIN scores ON scores.id = revisions.score_id
            """
        )
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                """
                INSERT INTO playback_outbox (
                    outbox_uuid,
                    score_id,
                    revision_id,
                    requested_by_user_id,
                    source_fingerprint,
                    asset_kind,
                    status,
                    attempt_count,
                    next_attempt_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    :outbox_uuid,
                    :score_id,
                    :revision_id,
                    :requested_by_user_id,
                    :source_fingerprint,
                    'AUDIO',
                    'PENDING',
                    0,
                    :now,
                    :now,
                    :now
                )
                """
            ),
            {
                "outbox_uuid": str(uuid.uuid4()),
                "score_id": row["score_id"],
                "revision_id": row["revision_id"],
                "requested_by_user_id": row["user_id"],
                "source_fingerprint": row["source_fingerprint"],
                "now": now,
            },
        )
