"""add library learning state

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-24 17:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


practice_state_enum = postgresql.ENUM(
    "TO_PRACTICE",
    "IN_PROGRESS",
    "MASTERED",
    name="librarypracticestate",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    practice_state_enum.create(bind, checkfirst=True)
    op.add_column(
        "score_library_entries",
        sa.Column(
            "practice_state",
            practice_state_enum,
            server_default="TO_PRACTICE",
            nullable=False,
        ),
    )
    op.alter_column("score_library_entries", "practice_state", server_default=None)
    op.create_index(
        "idx_score_library_entries_user_practice_state",
        "score_library_entries",
        ["user_id", "practice_state"],
    )
    op.create_index(
        "idx_score_library_entries_user_practiced",
        "score_library_entries",
        ["user_id", "last_practiced_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_score_library_entries_user_practiced",
        table_name="score_library_entries",
    )
    op.drop_index(
        "idx_score_library_entries_user_practice_state",
        table_name="score_library_entries",
    )
    op.drop_column("score_library_entries", "practice_state")
    practice_state_enum.drop(op.get_bind(), checkfirst=True)
