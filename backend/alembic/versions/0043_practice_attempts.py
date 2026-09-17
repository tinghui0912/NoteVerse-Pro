"""Add practice attempt records.

Revision ID: 0043_practice_attempts
Revises: 0042_practice_input_source
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0043_practice_attempts"
down_revision: str | None = "0042_practice_input_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PRACTICE_ATTEMPT_RESULT_VALUES = (
    "MATCH",
    "PARTIAL",
    "MISMATCH",
    "UNCERTAIN",
    "OTHER",
)
PRACTICE_ATTEMPT_COMPLETION_STATUS_VALUES = (
    "COMPLETED",
    "INTERRUPTED",
)
PRACTICE_ATTEMPT_RESOLUTION_REASON_VALUES = (
    "stable_match",
    "partial_match",
    "entry_mismatch",
    "low_alignment_confidence",
    "holding_position",
    "reacquiring",
    "large_jump",
    "insufficient_input",
    "practice_paused",
    "practice_finished",
    "connection_closed",
)
PRACTICE_INPUT_SOURCE_VALUES = (
    "MICROPHONE",
    "MIDI",
)

practice_attempt_result_enum = postgresql.ENUM(
    *PRACTICE_ATTEMPT_RESULT_VALUES,
    name="practiceattemptresult",
    create_type=False,
)
practice_attempt_completion_status_enum = postgresql.ENUM(
    *PRACTICE_ATTEMPT_COMPLETION_STATUS_VALUES,
    name="practiceattemptcompletionstatus",
    create_type=False,
)
practice_attempt_resolution_reason_enum = postgresql.ENUM(
    *PRACTICE_ATTEMPT_RESOLUTION_REASON_VALUES,
    name="practiceattemptresolutionreason",
    create_type=False,
)
practice_input_source_enum = postgresql.ENUM(
    *PRACTICE_INPUT_SOURCE_VALUES,
    name="practiceinputsource",
    create_type=False,
)


def _create_postgresql_enum_type(name: str, values: tuple[str, ...]) -> None:
    enum_values = ", ".join(f"'{value}'" for value in values)
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
                CREATE TYPE {name} AS ENUM ({enum_values});
            EXCEPTION WHEN duplicate_object THEN
                NULL;
            END
            $$
            """
        )
    )


def upgrade() -> None:
    _create_postgresql_enum_type("practiceattemptresult", PRACTICE_ATTEMPT_RESULT_VALUES)
    _create_postgresql_enum_type(
        "practiceattemptcompletionstatus",
        PRACTICE_ATTEMPT_COMPLETION_STATUS_VALUES,
    )
    _create_postgresql_enum_type(
        "practiceattemptresolutionreason",
        PRACTICE_ATTEMPT_RESOLUTION_REASON_VALUES,
    )
    op.create_table(
        "practice_attempts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("attempt_index", sa.BigInteger(), nullable=False),
        sa.Column("attempt_uid", sa.String(length=160), nullable=False),
        sa.Column("started_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("resolved_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("expected_group_id", sa.String(length=128), nullable=True),
        sa.Column("event_id", sa.String(length=128), nullable=True),
        sa.Column("beat_position", sa.Float(), nullable=False),
        sa.Column("render_note_ids", sa.Text(), nullable=True),
        sa.Column("measure_numbers", sa.Text(), nullable=True),
        sa.Column("result", practice_attempt_result_enum, nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("completion_status", practice_attempt_completion_status_enum, nullable=False),
        sa.Column("resolution_reason", practice_attempt_resolution_reason_enum, nullable=False),
        sa.Column("experience_state", sa.String(length=64), nullable=False),
        sa.Column("input_source", practice_input_source_enum, nullable=False),
        sa.Column("evidence_profile", sa.String(length=64), nullable=False),
        sa.Column("correctness_scope", sa.String(length=128), nullable=False),
        sa.Column("evaluator_version", sa.String(length=64), nullable=True),
        sa.Column("policy_profile_version", sa.String(length=64), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("validation_confidence", sa.Float(), nullable=True),
        sa.Column("input_policy_confidence", sa.Float(), nullable=True),
        sa.Column("timestamp_ms", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["practice_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_practice_attempts_session_index",
        "practice_attempts",
        ["session_id", "attempt_index"],
    )
    op.create_index(
        "idx_practice_attempts_session_group",
        "practice_attempts",
        ["session_id", "expected_group_id"],
    )
    op.create_index(
        "uq_practice_attempts_session_uid",
        "practice_attempts",
        ["session_id", "attempt_uid"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_index("uq_practice_attempts_session_uid", table_name="practice_attempts")
    op.drop_index("idx_practice_attempts_session_group", table_name="practice_attempts")
    op.drop_index("idx_practice_attempts_session_index", table_name="practice_attempts")
    op.drop_table("practice_attempts")
    practice_attempt_resolution_reason_enum.drop(bind, checkfirst=True)
    practice_attempt_completion_status_enum.drop(bind, checkfirst=True)
    practice_attempt_result_enum.drop(bind, checkfirst=True)
