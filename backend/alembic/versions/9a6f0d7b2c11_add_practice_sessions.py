"""add_practice_sessions

Revision ID: 9a6f0d7b2c11
Revises: eac35c9bec75
Create Date: 2026-04-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9a6f0d7b2c11"
down_revision: Union[str, None] = "eac35c9bec75"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "practice_sessions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("session_uuid", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("share_token", sa.String(length=64), nullable=True),
        sa.Column("source_type", sa.Enum("final", "current", name="practicesourcetype"), nullable=False),
        sa.Column(
            "state",
            sa.Enum("CREATED", "STREAMING", "PAUSED", "FINISHED", "FAILED", name="practicesessionstate"),
            nullable=False,
        ),
        sa.Column("sample_rate", sa.BigInteger(), nullable=False),
        sa.Column("channels", sa.BigInteger(), nullable=False),
        sa.Column("frame_format", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("last_event_index", sa.BigInteger(), nullable=True),
        sa.Column("last_measure_index", sa.BigInteger(), nullable=True),
        sa.Column("last_beat_position", sa.Float(), nullable=True),
        sa.Column("last_confidence", sa.Float(), nullable=True),
        sa.Column("audio_path", sa.String(length=512), nullable=True),
        sa.Column(
            "report_status",
            sa.Enum("NOT_REQUESTED", "PENDING", "READY", "FAILED", name="practicereportstatus"),
            nullable=False,
        ),
        sa.Column("report_payload", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_uuid"),
    )
    op.create_index(
        "idx_practice_sessions_user_created",
        "practice_sessions",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_practice_sessions_task_created",
        "practice_sessions",
        ["task_id", "created_at"],
        unique=False,
    )
    op.create_index("idx_practice_sessions_state", "practice_sessions", ["state"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_practice_sessions_state", table_name="practice_sessions")
    op.drop_index("idx_practice_sessions_task_created", table_name="practice_sessions")
    op.drop_index("idx_practice_sessions_user_created", table_name="practice_sessions")
    op.drop_table("practice_sessions")
    sa.Enum(name="practicereportstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="practicesessionstate").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="practicesourcetype").drop(op.get_bind(), checkfirst=True)
