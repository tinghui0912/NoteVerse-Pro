"""split my scores from library entry sources

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-24 16:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


new_source_type = postgresql.ENUM(
    "SELF_ADDED",
    "BOOKMARK",
    "SHARED",
    "OFFICIAL",
    "AI_RECOMMENDED",
    name="libraryentrysourcetype",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("DELETE FROM score_library_entries")
    op.drop_index("uq_score_library_entries_active_source", table_name="score_library_entries")
    op.alter_column(
        "score_library_entries",
        "source_type",
        existing_type=sa.Enum(name="libraryentrysourcetype"),
        type_=sa.String(length=32),
        postgresql_using="source_type::text",
    )
    postgresql.ENUM(name="libraryentrysourcetype").drop(bind, checkfirst=True)
    new_source_type.create(bind, checkfirst=True)
    op.alter_column(
        "score_library_entries",
        "source_type",
        existing_type=sa.String(length=32),
        type_=new_source_type,
        postgresql_using="source_type::libraryentrysourcetype",
        nullable=False,
    )
    op.create_index(
        "uq_score_library_entries_active_source",
        "score_library_entries",
        ["user_id", "score_id", "source_type"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DELETE FROM score_library_entries")
    op.drop_index("uq_score_library_entries_active_source", table_name="score_library_entries")
    op.alter_column(
        "score_library_entries",
        "source_type",
        existing_type=new_source_type,
        type_=sa.String(length=32),
        postgresql_using="source_type::text",
    )
    new_source_type.drop(bind, checkfirst=True)
    postgresql.ENUM("OWNED", "BOOKMARK", name="libraryentrysourcetype").create(
        bind, checkfirst=True
    )
    op.alter_column(
        "score_library_entries",
        "source_type",
        existing_type=sa.String(length=32),
        type_=postgresql.ENUM("OWNED", "BOOKMARK", name="libraryentrysourcetype", create_type=False),
        postgresql_using="source_type::libraryentrysourcetype",
        nullable=False,
    )
    op.create_index(
        "uq_score_library_entries_active_source",
        "score_library_entries",
        ["user_id", "score_id", "source_type"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
