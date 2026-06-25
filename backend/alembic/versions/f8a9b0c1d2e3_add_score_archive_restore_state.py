"""add score archive restore state

Revision ID: f8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-06-25 10:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f8a9b0c1d2e3"
down_revision: Union[str, Sequence[str], None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


score_state_enum = postgresql.ENUM(
    "IN_REVIEW",
    "ACTIVE",
    "ARCHIVED",
    name="scorestate",
    create_type=False,
)


def upgrade() -> None:
    op.add_column(
        "scores",
        sa.Column("archived_from_state", score_state_enum, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scores", "archived_from_state")
