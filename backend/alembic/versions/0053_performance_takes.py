"""Add performance_takes table.

Revision ID: 0053_performance_takes
Revises: 0052_practice_step_verifier_provider
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0053_performance_takes"
down_revision: str | None = "0052_practice_step_verifier_provider"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


media_kind_enum = sa.Enum(
    "AUDIO",
    name="performancetakemediakind",
)


def upgrade() -> None:
    bind = op.get_bind()
    media_kind_enum.create(bind, checkfirst=True)
    op.create_table(
        "performance_takes",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=True),
        sa.Column("artifact_id", sa.String(length=128), nullable=True),
        sa.Column("client_request_id", sa.String(length=128), nullable=False),
        sa.Column("media_kind", media_kind_enum, nullable=False, server_default="AUDIO"),
        sa.Column("media_mime_type", sa.String(length=64), nullable=False),
        sa.Column("media_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("media_object_key", sa.String(length=768), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("scope_start_beat", sa.Float(), nullable=False),
        sa.Column("scope_terminal_beat", sa.Float(), nullable=False),
        sa.Column("tempo_selection", sa.Text(), nullable=True),
        sa.Column("resolved_tempo_plan", sa.Text(), nullable=True),
        sa.Column("sync_metadata", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("user_id", "client_request_id", name="uq_performance_takes_user_client_request_id"),
    )
    op.create_index("ix_performance_takes_take_uuid", "performance_takes", ["take_uuid"], unique=True)
    op.create_index("ix_performance_takes_user_id", "performance_takes", ["user_id"])
    op.create_index("ix_performance_takes_score_id", "performance_takes", ["score_id"])
    op.create_index("ix_performance_takes_revision_id", "performance_takes", ["revision_id"])
    op.create_index("ix_performance_takes_client_request_id", "performance_takes", ["client_request_id"])
    op.create_index("ix_performance_takes_media_object_key", "performance_takes", ["media_object_key"], unique=True)
    op.create_index("ix_performance_takes_user_created", "performance_takes", ["user_id", "created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_index("ix_performance_takes_user_created", table_name="performance_takes")
    op.drop_index("ix_performance_takes_media_object_key", table_name="performance_takes")
    op.drop_index("ix_performance_takes_client_request_id", table_name="performance_takes")
    op.drop_index("ix_performance_takes_revision_id", table_name="performance_takes")
    op.drop_index("ix_performance_takes_score_id", table_name="performance_takes")
    op.drop_index("ix_performance_takes_user_id", table_name="performance_takes")
    op.drop_index("ix_performance_takes_take_uuid", table_name="performance_takes")
    op.drop_table("performance_takes")
    media_kind_enum.drop(bind, checkfirst=True)
