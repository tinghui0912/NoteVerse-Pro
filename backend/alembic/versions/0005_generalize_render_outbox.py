"""generalize durable render outbox

Revision ID: 0005_generalize_render_outbox
Revises: 0004_import_dispatch_claim
Create Date: 2026-07-07
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0005_generalize_render_outbox"
down_revision: str | Sequence[str] | None = "0004_import_dispatch_claim"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


target_type_enum = postgresql.ENUM(
    "SCORE_REVISION",
    "REVIEW_THUMBNAIL",
    name="rendertargettype",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    sa.Enum("SCORE_REVISION", "REVIEW_THUMBNAIL", name="rendertargettype").create(
        bind, checkfirst=True
    )
    op.rename_table("revision_render_outbox", "render_outbox")
    op.drop_constraint(
        "uq_render_outbox_revision_profile", "render_outbox", type_="unique"
    )
    op.alter_column("render_outbox", "score_id", existing_type=sa.BigInteger(), nullable=True)
    op.alter_column("render_outbox", "revision_id", existing_type=sa.BigInteger(), nullable=True)
    op.add_column("render_outbox", sa.Column("target_type", target_type_enum, nullable=True))
    op.add_column("render_outbox", sa.Column("import_job_id", sa.BigInteger(), nullable=True))
    op.add_column("render_outbox", sa.Column("source_fingerprint", sa.String(64), nullable=True))
    op.create_foreign_key(
        "fk_render_outbox_import_job_id",
        "render_outbox",
        "import_jobs",
        ["import_job_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(
        sa.text(
            """
            UPDATE render_outbox AS o
            SET target_type = 'SCORE_REVISION',
                source_fingerprint = r.content_hash
            FROM score_revisions AS r
            WHERE r.id = o.revision_id
            """
        )
    )
    op.alter_column("render_outbox", "target_type", existing_type=target_type_enum, nullable=False)
    op.alter_column("render_outbox", "source_fingerprint", existing_type=sa.String(64), nullable=False)
    op.create_check_constraint(
        "ck_render_outbox_target",
        "render_outbox",
        "(target_type = 'SCORE_REVISION' AND score_id IS NOT NULL AND revision_id IS NOT NULL AND import_job_id IS NULL) OR "
        "(target_type = 'REVIEW_THUMBNAIL' AND score_id IS NULL AND revision_id IS NULL AND import_job_id IS NOT NULL)",
    )
    op.create_unique_constraint(
        "uq_render_outbox_revision_profile",
        "render_outbox",
        ["revision_id", "render_profile"],
    )
    op.create_unique_constraint(
        "uq_render_outbox_review_source",
        "render_outbox",
        ["import_job_id", "render_profile", "source_fingerprint"],
    )


def downgrade() -> None:
    op.execute("DELETE FROM render_outbox WHERE target_type = 'REVIEW_THUMBNAIL'")
    op.drop_constraint("uq_render_outbox_review_source", "render_outbox", type_="unique")
    op.drop_constraint("uq_render_outbox_revision_profile", "render_outbox", type_="unique")
    op.drop_constraint("ck_render_outbox_target", "render_outbox", type_="check")
    op.drop_constraint("fk_render_outbox_import_job_id", "render_outbox", type_="foreignkey")
    op.drop_column("render_outbox", "source_fingerprint")
    op.drop_column("render_outbox", "import_job_id")
    op.drop_column("render_outbox", "target_type")
    op.alter_column("render_outbox", "revision_id", existing_type=sa.BigInteger(), nullable=False)
    op.alter_column("render_outbox", "score_id", existing_type=sa.BigInteger(), nullable=False)
    op.create_unique_constraint(
        "uq_render_outbox_revision_profile",
        "render_outbox",
        ["revision_id", "render_profile"],
    )
    op.rename_table("render_outbox", "revision_render_outbox")
    sa.Enum(name="rendertargettype").drop(op.get_bind(), checkfirst=True)
