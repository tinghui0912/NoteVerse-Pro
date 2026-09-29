"""Drop legacy server practice runtime tables.

Revision ID: 0062_drop_legacy_practice_runtime
Revises: 0061_performance_take_status_checks
Create Date: 2026-09-29 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

from alembic import op


revision: str = "0062_drop_legacy_practice_runtime"
down_revision: str | Sequence[str] | None = "0061_performance_take_status_checks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


LEGACY_PRACTICE_ENUMS = (
    "practicereplayobjectdeletionstatus",
    "practicereplayartifactkind",
    "practiceattemptresolutionreason",
    "practiceattemptcompletionstatus",
    "practiceattemptresult",
    "practicestepmicrophoneverificationprovider",
    "practicesessionsummarystatus",
    "practicesessioncompletionreason",
    "practiceinputsource",
    "practiceevaluationprofile",
    "practicerealtimeguidance",
    "practiceprogressionmode",
    "practicesessionstate",
)


def upgrade() -> None:
    op.drop_table("practice_replay_object_deletion_outbox", if_exists=True)
    op.drop_table("practice_replay_artifacts", if_exists=True)
    op.drop_table("practice_attempts", if_exists=True)
    op.drop_table("practice_sessions", if_exists=True)

    for enum_name in LEGACY_PRACTICE_ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")


def downgrade() -> None:
    raise RuntimeError(
        "0062_drop_legacy_practice_runtime is destructive; "
        "restore legacy server practice runtime tables from Git history if needed."
    )
