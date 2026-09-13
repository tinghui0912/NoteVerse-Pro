"""Add scoped practice session target.

Revision ID: 0044_practice_session_scope
Revises: 0043_practice_attempts
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0044_practice_session_scope"
down_revision: str | None = "0043_practice_attempts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "practice_sessions",
        sa.Column("scope_start_expected_group_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "practice_sessions",
        sa.Column("scope_end_expected_group_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "practice_sessions",
        sa.Column("scope_start_measure_number", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "practice_sessions",
        sa.Column("scope_end_measure_number", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("practice_sessions", "scope_start_measure_number")
    op.drop_column("practice_sessions", "scope_end_measure_number")
    op.drop_column("practice_sessions", "scope_end_expected_group_id")
    op.drop_column("practice_sessions", "scope_start_expected_group_id")
