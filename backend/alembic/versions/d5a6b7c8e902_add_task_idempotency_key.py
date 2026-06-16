"""add task idempotency key

Revision ID: d5a6b7c8e902
Revises: c8d4e2f7a901
Create Date: 2026-06-14 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d5a6b7c8e902"
down_revision: Union[str, None] = "c8d4e2f7a901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("idempotency_key", sa.String(length=128), nullable=True))
    op.create_unique_constraint(
        "uq_tasks_user_idempotency_key",
        "tasks",
        ["user_id", "idempotency_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_tasks_user_idempotency_key", "tasks", type_="unique")
    op.drop_column("tasks", "idempotency_key")
