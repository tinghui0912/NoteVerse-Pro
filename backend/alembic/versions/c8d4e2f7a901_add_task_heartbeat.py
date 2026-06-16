"""add task heartbeat

Revision ID: c8d4e2f7a901
Revises: b7e9c2d4a6f1
Create Date: 2026-06-13 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8d4e2f7a901"
down_revision: Union[str, None] = "b7e9c2d4a6f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "last_heartbeat_at")
