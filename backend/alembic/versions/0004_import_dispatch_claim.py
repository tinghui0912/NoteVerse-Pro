"""add import dispatch publish attempts

Revision ID: 0004_import_dispatch_claim
Revises: 0003_import_job_dispatch
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_import_dispatch_claim"
down_revision = "0003_import_job_dispatch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "import_jobs",
        sa.Column("publish_attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_import_jobs_publish_attempt_count",
        "import_jobs",
        "publish_attempt_count >= 0",
    )
    op.alter_column("import_jobs", "publish_attempt_count", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ck_import_jobs_publish_attempt_count", "import_jobs", type_="check")
    op.drop_column("import_jobs", "publish_attempt_count")
