"""add storage blobs and score input assets

Revision ID: 0017_storage_blobs
Revises: 0016_storage_usage
Create Date: 2026-07-14 00:00:00.000000

"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0017_storage_blobs"
down_revision: str | Sequence[str] | None = "0016_storage_usage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute("ALTER TYPE storageusagecategory ADD VALUE IF NOT EXISTS 'INPUT_ASSET'")
        op.execute("DROP TYPE IF EXISTS scoreinputassetpurpose")

    op.create_table(
        "storage_blobs",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("blob_uuid", sa.String(length=36), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("storage_key", sa.String(length=768), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sha256", name="uq_storage_blobs_sha256"),
        sa.UniqueConstraint("storage_key", name="uq_storage_blobs_storage_key"),
    )
    op.create_index("idx_storage_blobs_sha256", "storage_blobs", ["sha256"])

    with op.batch_alter_table("uploads") as batch:
        batch.add_column(sa.Column("upload_uuid", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("blob_id", sa.BigInteger(), nullable=True))
        batch.create_index("idx_uploads_blob", ["blob_id"])
        batch.create_index("idx_uploads_user_created", ["uploader_user_id", "created_at"])

    if dialect == "postgresql":
        op.execute(
            """
            INSERT INTO storage_blobs (
                blob_uuid, sha256, storage_backend, storage_key, filename, size_bytes, mime_type, created_at
            )
            SELECT
                '10000000-0000-0000-0000-' || lpad(id::text, 12, '0'),
                sha256,
                storage_backend,
                storage_key,
                filename,
                COALESCE(size_bytes, 0),
                COALESCE(mime_type, 'application/octet-stream'),
                created_at
            FROM uploads
            ON CONFLICT (sha256) DO NOTHING
            """
        )
        op.execute(
            """
            UPDATE uploads
            SET
                upload_uuid = '20000000-0000-0000-0000-' || lpad(uploads.id::text, 12, '0'),
                blob_id = storage_blobs.id
            FROM storage_blobs
            WHERE storage_blobs.sha256 = uploads.sha256
            """
        )
    else:
        op.execute(
            """
            INSERT INTO storage_blobs (
                blob_uuid, sha256, storage_backend, storage_key, filename, size_bytes, mime_type, created_at
            )
            SELECT
                printf('10000000-0000-0000-0000-%012d', id),
                sha256,
                storage_backend,
                storage_key,
                filename,
                COALESCE(size_bytes, 0),
                COALESCE(mime_type, 'application/octet-stream'),
                created_at
            FROM uploads
            """
        )
        op.execute(
            """
            UPDATE uploads
            SET
                upload_uuid = printf('20000000-0000-0000-0000-%012d', id),
                blob_id = (
                    SELECT storage_blobs.id
                    FROM storage_blobs
                    WHERE storage_blobs.sha256 = uploads.sha256
                    LIMIT 1
                )
            """
        )

    with op.batch_alter_table("uploads") as batch:
        batch.alter_column("upload_uuid", nullable=False)
        batch.alter_column("blob_id", nullable=False)
        batch.create_unique_constraint("uq_uploads_upload_uuid", ["upload_uuid"])
        batch.create_foreign_key(
            "fk_uploads_blob_id_storage_blobs",
            "storage_blobs",
            ["blob_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        if dialect == "postgresql":
            batch.drop_constraint("uploads_sha256_key", type_="unique")
            batch.drop_constraint("uploads_storage_key_key", type_="unique")
        batch.drop_column("sha256")
        batch.drop_column("storage_backend")
        batch.drop_column("storage_key")
        batch.drop_column("filename")
        batch.drop_column("size_bytes")
        batch.drop_column("mime_type")

    with op.batch_alter_table("import_job_uploads") as batch:
        batch.add_column(sa.Column("page_number", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("sort_order", sa.Integer(), nullable=True))

    if dialect == "postgresql":
        op.execute(
            """
            WITH ordered AS (
                SELECT id, row_number() OVER (PARTITION BY job_id ORDER BY id) AS rn
                FROM import_job_uploads
            )
            UPDATE import_job_uploads
            SET page_number = ordered.rn, sort_order = ordered.rn
            FROM ordered
            WHERE ordered.id = import_job_uploads.id
            """
        )
    else:
        op.execute(
            """
            UPDATE import_job_uploads
            SET
                page_number = (
                    SELECT count(*)
                    FROM import_job_uploads AS previous
                    WHERE previous.job_id = import_job_uploads.job_id
                      AND previous.id <= import_job_uploads.id
                ),
                sort_order = (
                    SELECT count(*)
                    FROM import_job_uploads AS previous
                    WHERE previous.job_id = import_job_uploads.job_id
                      AND previous.id <= import_job_uploads.id
                )
            """
        )

    with op.batch_alter_table("import_job_uploads") as batch:
        batch.alter_column("page_number", nullable=False)
        batch.alter_column("sort_order", nullable=False)

    op.create_table(
        "score_input_assets",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("asset_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("upload_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "purpose",
            sa.String(length=32),
            nullable=False,
        ),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["upload_id"], ["uploads.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_uuid"),
        sa.UniqueConstraint("score_id", "upload_id", name="uq_score_input_assets_score_upload"),
    )
    op.create_index("idx_score_input_assets_score_order", "score_input_assets", ["score_id", "sort_order"])
    op.create_index("idx_score_input_assets_upload", "score_input_assets", ["upload_id"])


def downgrade() -> None:
    op.drop_index("idx_score_input_assets_upload", table_name="score_input_assets")
    op.drop_index("idx_score_input_assets_score_order", table_name="score_input_assets")
    op.drop_table("score_input_assets")
    with op.batch_alter_table("import_job_uploads") as batch:
        batch.drop_column("sort_order")
        batch.drop_column("page_number")

    with op.batch_alter_table("uploads") as batch:
        batch.add_column(sa.Column("mime_type", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("size_bytes", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("filename", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("storage_key", sa.String(length=768), nullable=True))
        batch.add_column(sa.Column("storage_backend", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("sha256", sa.String(length=64), nullable=True))

    op.execute(
        """
        UPDATE uploads
        SET
            sha256 = (SELECT sha256 FROM storage_blobs WHERE storage_blobs.id = uploads.blob_id),
            storage_backend = (SELECT storage_backend FROM storage_blobs WHERE storage_blobs.id = uploads.blob_id),
            storage_key = (SELECT storage_key FROM storage_blobs WHERE storage_blobs.id = uploads.blob_id),
            filename = (SELECT filename FROM storage_blobs WHERE storage_blobs.id = uploads.blob_id),
            size_bytes = (SELECT size_bytes FROM storage_blobs WHERE storage_blobs.id = uploads.blob_id),
            mime_type = (SELECT mime_type FROM storage_blobs WHERE storage_blobs.id = uploads.blob_id)
        """
    )
    with op.batch_alter_table("uploads") as batch:
        batch.alter_column("sha256", nullable=False)
        batch.alter_column("storage_backend", nullable=False)
        batch.alter_column("storage_key", nullable=False)
        batch.alter_column("filename", nullable=False)
        batch.drop_constraint("fk_uploads_blob_id_storage_blobs", type_="foreignkey")
        batch.drop_index("idx_uploads_user_created")
        batch.drop_index("idx_uploads_blob")
        batch.drop_constraint("uq_uploads_upload_uuid", type_="unique")
        batch.drop_column("blob_id")
        batch.drop_column("upload_uuid")
        batch.create_unique_constraint("uploads_sha256_key", ["sha256"])
        batch.create_unique_constraint("uploads_storage_key_key", ["storage_key"])
    op.drop_index("idx_storage_blobs_sha256", table_name="storage_blobs")
    op.drop_table("storage_blobs")
