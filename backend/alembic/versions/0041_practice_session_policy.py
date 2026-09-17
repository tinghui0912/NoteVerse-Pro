"""Add practice session policy.

Revision ID: 0041_practice_session_policy
Revises: 0040_playback_exec_manifest
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0041_practice_session_policy"
down_revision: str | None = "0040_playback_exec_manifest"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


practice_progression_mode_enum = sa.Enum(
    "WAIT_FOR_NOTE",
    "CONTINUOUS",
    name="practiceprogressionmode",
)
practice_realtime_guidance_enum = sa.Enum(
    "STATUS_ONLY",
    "GUIDED",
    name="practicerealtimeguidance",
)
practice_evaluation_profile_enum = sa.Enum(
    "LEARNING",
    "PERFORMANCE",
    name="practiceevaluationprofile",
)


def upgrade() -> None:
    bind = op.get_bind()
    practice_progression_mode_enum.create(bind, checkfirst=True)
    practice_realtime_guidance_enum.create(bind, checkfirst=True)
    practice_evaluation_profile_enum.create(bind, checkfirst=True)
    op.add_column(
        "practice_sessions",
        sa.Column(
            "progression_mode",
            practice_progression_mode_enum,
            nullable=False,
            server_default="CONTINUOUS",
        ),
    )
    op.add_column(
        "practice_sessions",
        sa.Column(
            "realtime_guidance",
            practice_realtime_guidance_enum,
            nullable=False,
            server_default="STATUS_ONLY",
        ),
    )
    op.add_column(
        "practice_sessions",
        sa.Column(
            "evaluation_profile",
            practice_evaluation_profile_enum,
            nullable=False,
            server_default="PERFORMANCE",
        ),
    )
    op.alter_column("practice_sessions", "progression_mode", server_default=None)
    op.alter_column("practice_sessions", "realtime_guidance", server_default=None)
    op.alter_column("practice_sessions", "evaluation_profile", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_column("practice_sessions", "evaluation_profile")
    op.drop_column("practice_sessions", "realtime_guidance")
    op.drop_column("practice_sessions", "progression_mode")
    practice_evaluation_profile_enum.drop(bind, checkfirst=True)
    practice_realtime_guidance_enum.drop(bind, checkfirst=True)
    practice_progression_mode_enum.drop(bind, checkfirst=True)
