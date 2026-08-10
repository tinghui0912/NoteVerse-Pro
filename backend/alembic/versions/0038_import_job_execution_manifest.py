"""Add normalized import-job execution provenance.

Revision ID: 0038_import_exec_manifest
Revises: 0037_remove_customer_user_role
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0038_import_exec_manifest"
down_revision: str | None = "0037_remove_customer_user_role"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "execution_manifests",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("manifest", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("sha256", name="uq_execution_manifests_sha256"),
    )
    op.add_column("import_jobs", sa.Column("execution_manifest_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_import_jobs_execution_manifest_id",
        "import_jobs",
        "execution_manifests",
        ["execution_manifest_id"],
        ["id"],
    )
    op.create_index(
        "ix_import_jobs_execution_manifest_id", "import_jobs", ["execution_manifest_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_import_jobs_execution_manifest_id", table_name="import_jobs")
    op.drop_constraint("fk_import_jobs_execution_manifest_id", "import_jobs", type_="foreignkey")
    op.drop_column("import_jobs", "execution_manifest_id")
    op.drop_table("execution_manifests")
