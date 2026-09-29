"""Add performance take evaluation.

Revision ID: 0068_add_performance_take_evaluation
Revises: 0067_simplify_recording_timebase
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0068_add_performance_take_evaluation"
down_revision: str | None = "0067_simplify_recording_timebase"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "performance_takes",
    "performance_take_upload_authorizations",
)

EMPTY_EVALUATION = '{"outcomes":[]}'


def upgrade() -> None:
    for table_name in TABLES:
        op.add_column(table_name, sa.Column("evaluation", sa.Text(), nullable=True))
        op.execute(
            sa.text(
                f"""
                UPDATE {table_name}
                SET evaluation = :evaluation
                WHERE evaluation IS NULL
                """
            ).bindparams(evaluation=EMPTY_EVALUATION)
        )
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.alter_column("evaluation", existing_type=sa.Text(), nullable=False)


def downgrade() -> None:
    raise RuntimeError("0068_add_performance_take_evaluation is destructive; restore from Git history.")
