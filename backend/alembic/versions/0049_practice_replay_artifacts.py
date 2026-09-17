"""Add saved practice replay artifacts.

Revision ID: 0049_practice_replay_artifacts
Revises: 0048_rename_user_finished
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0049_practice_replay_artifacts"
down_revision: str | None = "0048_rename_user_finished"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


replay_kind_enum = postgresql.ENUM(
    "AUDIO_RECORDING",
    "MIDI_EVENTS",
    name="practicereplayartifactkind",
    create_type=False,
)

practice_input_source_enum = postgresql.ENUM(
    name="practiceinputsource",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    replay_kind_enum.create(bind, checkfirst=True)
    op.create_table(
        "practice_replay_artifacts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("artifact_uuid", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", replay_kind_enum, nullable=False),
        sa.Column("input_source", practice_input_source_enum, nullable=False),
        sa.Column("storage_backend", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False),
        sa.Column("timebase_version", sa.BigInteger(), nullable=False),
        sa.Column("format_version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["practice_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_practice_replay_artifacts_session_created",
        "practice_replay_artifacts",
        ["session_id", "created_at"],
    )
    op.create_index(
        "uq_practice_replay_artifacts_uuid",
        "practice_replay_artifacts",
        ["artifact_uuid"],
        unique=True,
    )
    op.create_index(
        "uq_practice_replay_artifacts_object_key",
        "practice_replay_artifacts",
        ["object_key"],
        unique=True,
    )
    op.create_index(
        "uq_practice_replay_artifacts_session_kind",
        "practice_replay_artifacts",
        ["session_id", "kind"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_table("practice_replay_artifacts")
    replay_kind_enum.drop(bind, checkfirst=True)
