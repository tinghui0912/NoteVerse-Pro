"""Rename practice session report columns to summary columns.

Revision ID: 0045_practice_summary_columns
Revises: 0044_practice_session_scope
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0045_practice_summary_columns"
down_revision: str | None = "0044_practice_session_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            CREATE TYPE practicesessionsummarystatus AS ENUM ('NOT_REQUESTED', 'PENDING', 'READY', 'FAILED');
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END
        $$
        """
    )
    op.alter_column(
        "practice_sessions",
        "report_status",
        new_column_name="summary_status",
        existing_type=sa.Enum(
            "NOT_REQUESTED",
            "PENDING",
            "READY",
            "FAILED",
            name="practicereportstatus",
        ),
        existing_nullable=False,
    )
    op.alter_column(
        "practice_sessions",
        "summary_status",
        type_=sa.Enum(
            "NOT_REQUESTED",
            "PENDING",
            "READY",
            "FAILED",
            name="practicesessionsummarystatus",
        ),
        existing_type=sa.Enum(
            "NOT_REQUESTED",
            "PENDING",
            "READY",
            "FAILED",
            name="practicereportstatus",
        ),
        postgresql_using="summary_status::text::practicesessionsummarystatus",
        existing_nullable=False,
    )
    op.alter_column(
        "practice_sessions",
        "report_payload",
        new_column_name="summary_payload",
        existing_type=sa.Text(),
        existing_nullable=True,
    )
    op.execute("DROP TYPE practicereportstatus")


def downgrade() -> None:
    op.execute(
        "CREATE TYPE practicereportstatus AS ENUM "
        "('NOT_REQUESTED', 'PENDING', 'READY', 'FAILED')"
    )
    op.alter_column(
        "practice_sessions",
        "summary_status",
        type_=sa.Enum(
            "NOT_REQUESTED",
            "PENDING",
            "READY",
            "FAILED",
            name="practicereportstatus",
        ),
        existing_type=sa.Enum(
            "NOT_REQUESTED",
            "PENDING",
            "READY",
            "FAILED",
            name="practicesessionsummarystatus",
        ),
        postgresql_using="summary_status::text::practicereportstatus",
        existing_nullable=False,
    )
    op.alter_column(
        "practice_sessions",
        "summary_status",
        new_column_name="report_status",
        existing_type=sa.Enum(
            "NOT_REQUESTED",
            "PENDING",
            "READY",
            "FAILED",
            name="practicereportstatus",
        ),
        existing_nullable=False,
    )
    op.alter_column(
        "practice_sessions",
        "summary_payload",
        new_column_name="report_payload",
        existing_type=sa.Text(),
        existing_nullable=True,
    )
    op.execute("DROP TYPE practicesessionsummarystatus")
