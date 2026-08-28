"""Add explicit input source to practice sessions.

Revision ID: 0042_practice_input_source
Revises: 0041_practice_session_policy
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0042_practice_input_source"
down_revision: str | None = "0041_practice_session_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


practice_input_source_enum = sa.Enum(
    "MICROPHONE",
    "MIDI",
    name="practiceinputsource",
)


def upgrade() -> None:
    bind = op.get_bind()
    practice_input_source_enum.create(bind, checkfirst=True)
    op.add_column(
        "practice_sessions",
        sa.Column(
            "input_source",
            practice_input_source_enum,
            nullable=False,
            server_default="MICROPHONE",
        ),
    )
    op.alter_column("practice_sessions", "input_source", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_column("practice_sessions", "input_source")
    practice_input_source_enum.drop(bind, checkfirst=True)
