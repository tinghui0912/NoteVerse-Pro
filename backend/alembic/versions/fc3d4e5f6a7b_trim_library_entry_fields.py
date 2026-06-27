"""trim library entry fields

Revision ID: fc3d4e5f6a7b
Revises: fb2c3d4e5f6a
Create Date: 2026-06-27 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "fc3d4e5f6a7b"
down_revision: Union[str, None] = "fb2c3d4e5f6a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE_SOURCE_VALUES = ("SELF_ADDED", "BOOKMARK")
LEGACY_SOURCE_VALUES = ("SELF_ADDED", "BOOKMARK", "SHARED", "OFFICIAL", "AI_RECOMMENDED")


def _replace_source_enum(values: tuple[str, ...]) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    value_sql = ", ".join(f"'{value}'" for value in values)
    op.execute("ALTER TABLE score_library_entries ALTER COLUMN source_type TYPE text USING source_type::text")
    op.execute("DROP TYPE libraryentrysourcetype")
    op.execute(f"CREATE TYPE libraryentrysourcetype AS ENUM ({value_sql})")
    op.execute(
        "ALTER TABLE score_library_entries "
        "ALTER COLUMN source_type TYPE libraryentrysourcetype "
        "USING source_type::libraryentrysourcetype"
    )


def upgrade() -> None:
    with op.batch_alter_table("score_library_entries") as batch_op:
        batch_op.drop_column("pinned_at")
        batch_op.drop_column("last_opened_at")
    _replace_source_enum(ACTIVE_SOURCE_VALUES)


def downgrade() -> None:
    with op.batch_alter_table("score_library_entries") as batch_op:
        batch_op.add_column(sa.Column("last_opened_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("pinned_at", sa.DateTime(), nullable=True))
    _replace_source_enum(LEGACY_SOURCE_VALUES)
