"""Add saved practice replay object deletion outbox.

Revision ID: 0050_replay_delete_outbox
Revises: 0049_practice_replay_artifacts
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0050_replay_delete_outbox"
down_revision: str | None = "0049_practice_replay_artifacts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


deletion_status_enum = postgresql.ENUM(
    "PENDING",
    "DISPATCHED",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    name="practicereplayobjectdeletionstatus",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    deletion_status_enum.create(bind, checkfirst=True)
    op.create_table(
        "practice_replay_object_deletion_outbox",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("artifact_uuid", sa.String(length=36), nullable=False),
        sa.Column("storage_backend", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("status", deletion_status_enum, nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_practice_replay_object_delete_attempt_count",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_practice_replay_object_delete_status_available",
        "practice_replay_object_deletion_outbox",
        ["status", "next_attempt_at"],
    )
    op.create_index(
        "idx_practice_replay_object_delete_dispatched",
        "practice_replay_object_deletion_outbox",
        ["status", "dispatched_at"],
    )
    op.create_index(
        "uq_practice_replay_object_delete_artifact",
        "practice_replay_object_deletion_outbox",
        ["artifact_uuid"],
        unique=True,
    )
    op.create_index(
        "uq_practice_replay_object_delete_uuid",
        "practice_replay_object_deletion_outbox",
        ["outbox_uuid"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_table("practice_replay_object_deletion_outbox")
    deletion_status_enum.drop(bind, checkfirst=True)
