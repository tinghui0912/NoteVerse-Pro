"""Promote performance take tempo plan to the canonical field name.

Revision ID: 0066_promote_performance_take_tempo_plan
Revises: 0065_promote_performance_take_recording_timebase
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0066_promote_performance_take_tempo_plan"
down_revision: str | None = "0065_promote_performance_take_recording_timebase"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "performance_takes",
    "performance_take_upload_authorizations",
)


def _promote_tempo_plan(table_name: str) -> None:
    op.add_column(table_name, sa.Column("tempo_plan", sa.Text(), nullable=True))
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET tempo_plan = resolved_tempo_plan
            WHERE resolved_tempo_plan IS NOT NULL
            """
        )
    )
    op.execute(sa.text(f"DELETE FROM {table_name} WHERE tempo_plan IS NULL"))
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.alter_column("tempo_plan", existing_type=sa.Text(), nullable=False)
        batch_op.drop_column("resolved_tempo_plan")


def upgrade() -> None:
    for table_name in TABLES:
        _promote_tempo_plan(table_name)


def downgrade() -> None:
    raise RuntimeError(
        "0066_promote_performance_take_tempo_plan is destructive; restore from Git history."
    )
