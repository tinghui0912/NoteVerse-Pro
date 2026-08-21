"""Add explicit practice mode to practice sessions.

Revision ID: 0041_practice_session_mode
Revises: 0040_playback_exec_manifest
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0041_practice_session_mode"
down_revision: str | None = "0040_playback_exec_manifest"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


practice_mode_enum = sa.Enum(
    "FREE_FOLLOW",
    "WAIT_FOR_NOTE",
    "ASSESSMENT",
    "PERFORMANCE",
    name="practicemode",
)


def upgrade() -> None:
    bind = op.get_bind()
    practice_mode_enum.create(bind, checkfirst=True)
    op.add_column(
        "practice_sessions",
        sa.Column(
            "practice_mode",
            practice_mode_enum,
            nullable=False,
            server_default="FREE_FOLLOW",
        ),
    )
    op.alter_column("practice_sessions", "practice_mode", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_column("practice_sessions", "practice_mode")
    practice_mode_enum.drop(bind, checkfirst=True)
