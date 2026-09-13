"""Add neutral practice attempt skip values.

Revision ID: 0051_practice_attempt_skip
Revises: 0050_replay_delete_outbox
"""

from collections.abc import Sequence

from alembic import op


revision: str = "0051_practice_attempt_skip"
down_revision: str | None = "0050_replay_delete_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE practiceattemptresult ADD VALUE IF NOT EXISTS 'SKIPPED'")
    op.execute("ALTER TYPE practiceattemptresolutionreason ADD VALUE IF NOT EXISTS 'user_skipped'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely without rebuilding dependent columns.
    pass
