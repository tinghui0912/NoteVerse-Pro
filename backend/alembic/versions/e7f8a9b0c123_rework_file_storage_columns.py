"""rework file storage columns

Revision ID: e7f8a9b0c123
Revises: d5a6b7c8e902
Create Date: 2026-06-14 22:55:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7f8a9b0c123"
down_revision: Union[str, Sequence[str], None] = "d5a6b7c8e902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM task_uploads")
    op.execute("DELETE FROM files")
    op.execute("DELETE FROM uploads")

    op.drop_constraint("uq_file_task_kind_page", "files", type_="unique")

    op.add_column("files", sa.Column("storage_backend", sa.String(length=32), nullable=False))
    op.add_column("files", sa.Column("storage_key", sa.String(length=768), nullable=False))
    op.add_column("files", sa.Column("filename", sa.String(length=255), nullable=False))
    op.add_column("files", sa.Column("page_number", sa.Integer(), nullable=True))
    op.drop_column("files", "path")
    op.drop_column("files", "page")
    op.drop_column("files", "dpi")
    op.create_unique_constraint(
        "uq_file_task_kind_page",
        "files",
        ["task_id", "kind", "page_number"],
    )

    op.add_column("uploads", sa.Column("storage_backend", sa.String(length=32), nullable=False))
    op.add_column("uploads", sa.Column("storage_key", sa.String(length=768), nullable=False))
    op.add_column("uploads", sa.Column("filename", sa.String(length=255), nullable=False))
    op.drop_column("uploads", "stored_filename")
    op.create_unique_constraint("uq_uploads_storage_key", "uploads", ["storage_key"])


def downgrade() -> None:
    op.drop_constraint("uq_uploads_storage_key", "uploads", type_="unique")
    op.add_column("uploads", sa.Column("stored_filename", sa.String(length=255), nullable=False))
    op.drop_column("uploads", "filename")
    op.drop_column("uploads", "storage_key")
    op.drop_column("uploads", "storage_backend")

    op.drop_constraint("uq_file_task_kind_page", "files", type_="unique")
    op.add_column("files", sa.Column("dpi", sa.Integer(), nullable=True))
    op.add_column("files", sa.Column("page", sa.Integer(), nullable=True))
    op.add_column("files", sa.Column("path", sa.String(length=512), nullable=False))
    op.drop_column("files", "page_number")
    op.drop_column("files", "filename")
    op.drop_column("files", "storage_key")
    op.drop_column("files", "storage_backend")
    op.create_unique_constraint(
        "uq_file_task_kind_page",
        "files",
        ["task_id", "kind", "page"],
    )
