"""remove_practice_event_indexes

Revision ID: 3f4a2b1c9d8e
Revises: 9a6f0d7b2c11
Create Date: 2026-05-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3f4a2b1c9d8e"
down_revision: Union[str, None] = "9a6f0d7b2c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("practice_sessions", "last_event_index")
    op.drop_column("practice_sessions", "last_measure_index")


def downgrade() -> None:
    op.add_column(
        "practice_sessions",
        sa.Column("last_measure_index", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "practice_sessions",
        sa.Column("last_event_index", sa.BigInteger(), nullable=True),
    )
