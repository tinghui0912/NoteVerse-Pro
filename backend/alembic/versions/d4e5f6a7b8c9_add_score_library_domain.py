"""add score library domain

Revision ID: d4e5f6a7b8c9
Revises: c4d5e6f7a8b9
Create Date: 2026-06-24 10:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    source_type = postgresql.ENUM(
        "OWNED",
        "BOOKMARK",
        name="libraryentrysourcetype",
        create_type=False,
    )
    postgresql.ENUM(
        "OWNED",
        "BOOKMARK",
        name="libraryentrysourcetype",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "score_library_folders",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("folder_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("parent_folder_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("position >= 0", name="ck_score_library_folders_position"),
        sa.ForeignKeyConstraint(["parent_folder_id"], ["score_library_folders.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("folder_uuid"),
        sa.UniqueConstraint("user_id", "id", name="uq_score_library_folders_user_id_id"),
    )
    op.create_index(
        "idx_score_library_folders_user_parent",
        "score_library_folders",
        ["user_id", "parent_folder_id"],
    )
    op.create_index(
        "uq_score_library_folders_active_name",
        "score_library_folders",
        ["user_id", "parent_folder_id", "name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "score_library_entries",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("entry_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("source_type", source_type, nullable=False),
        sa.Column("folder_id", sa.BigInteger(), nullable=True),
        sa.Column("is_favorite", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("pinned_at", sa.DateTime(), nullable=True),
        sa.Column("last_opened_at", sa.DateTime(), nullable=True),
        sa.Column("last_practiced_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["folder_id"], ["score_library_folders.id"]),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_score_library_entries_user_folder",
        "score_library_entries",
        ["user_id", "folder_id"],
    )
    op.create_index(
        "idx_score_library_entries_user_updated",
        "score_library_entries",
        ["user_id", "updated_at"],
    )
    op.create_index(
        "idx_score_library_entries_user_favorite",
        "score_library_entries",
        ["user_id", "is_favorite"],
    )
    op.create_index(
        "uq_score_library_entries_active_source",
        "score_library_entries",
        ["user_id", "score_id", "source_type"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "uq_score_library_entries_active_uuid",
        "score_library_entries",
        ["entry_uuid"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_score_library_entries_active_uuid", table_name="score_library_entries")
    op.drop_index("uq_score_library_entries_active_source", table_name="score_library_entries")
    op.drop_index("idx_score_library_entries_user_favorite", table_name="score_library_entries")
    op.drop_index("idx_score_library_entries_user_updated", table_name="score_library_entries")
    op.drop_index("idx_score_library_entries_user_folder", table_name="score_library_entries")
    op.drop_table("score_library_entries")
    op.drop_index("uq_score_library_folders_active_name", table_name="score_library_folders")
    op.drop_index("idx_score_library_folders_user_parent", table_name="score_library_folders")
    op.drop_table("score_library_folders")
    postgresql.ENUM(name="libraryentrysourcetype").drop(op.get_bind(), checkfirst=True)
