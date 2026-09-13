"""Clear development practice history after practice timeline identity changes.

Revision ID: 0046_clear_practice_history
Revises: 0045_practice_summary_columns
"""

from collections.abc import Sequence

from alembic import op


revision: str = "0046_clear_practice_history"
down_revision: str | None = "0045_practice_summary_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM practice_sessions")


def downgrade() -> None:
    pass
