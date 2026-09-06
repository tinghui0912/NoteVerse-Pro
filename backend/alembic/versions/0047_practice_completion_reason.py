"""Add practice session completion reason.

Revision ID: 0047_practice_completion_reason
Revises: 0046_clear_practice_history
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0047_practice_completion_reason"
down_revision: str | None = "0046_clear_practice_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


completion_reason_enum = sa.Enum(
    "SCOPE_COMPLETED",
    "STOPPED_BY_USER",
    name="practicesessioncompletionreason",
)


def upgrade() -> None:
    bind = op.get_bind()
    completion_reason_enum.create(bind, checkfirst=True)
    columns = {column["name"] for column in sa.inspect(bind).get_columns("practice_sessions")}
    if "completion_reason" not in columns:
        op.add_column(
            "practice_sessions",
            sa.Column("completion_reason", completion_reason_enum, nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("practice_sessions")}
    if "completion_reason" in columns:
        op.drop_column("practice_sessions", "completion_reason")
    completion_reason_enum.drop(bind, checkfirst=True)
