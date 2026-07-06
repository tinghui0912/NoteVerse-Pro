"""add durable import job dispatch state

Revision ID: 0003_import_job_dispatch
Revises: 0002_revision_render_outbox
Create Date: 2026-07-07
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0003_import_job_dispatch"
down_revision: str | Sequence[str] | None = "0002_revision_render_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    status_enum = sa.Enum(
        "PENDING",
        "DISPATCHED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        name="importdispatchstatus",
    )
    status_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "import_jobs",
        sa.Column(
            "dispatch_status",
            status_enum,
            nullable=False,
            server_default="PENDING",
        ),
    )
    op.add_column(
        "import_jobs",
        sa.Column("dispatch_attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "import_jobs",
        sa.Column("next_dispatch_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.add_column("import_jobs", sa.Column("dispatched_at", sa.DateTime(), nullable=True))
    op.add_column("import_jobs", sa.Column("dispatch_started_at", sa.DateTime(), nullable=True))
    op.add_column("import_jobs", sa.Column("dispatch_completed_at", sa.DateTime(), nullable=True))
    op.add_column("import_jobs", sa.Column("dispatch_error", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_import_jobs_dispatch_attempt_count",
        "import_jobs",
        "dispatch_attempt_count >= 0",
    )
    enum_cast = "::importdispatchstatus" if op.get_bind().dialect.name == "postgresql" else ""
    op.execute(
        f"""
        UPDATE import_jobs
        SET dispatch_status = CASE
            WHEN state = 'PENDING' THEN 'PENDING'{enum_cast}
            WHEN state = 'RUNNING' THEN 'PROCESSING'{enum_cast}
            ELSE 'COMPLETED'{enum_cast}
        END,
        dispatch_completed_at = CASE
            WHEN state IN ('PENDING_REVIEW', 'CONFIRMED', 'FAILURE') THEN updated_at
            ELSE NULL
        END
        """
    )
    op.alter_column("import_jobs", "dispatch_status", server_default=None)
    op.alter_column("import_jobs", "dispatch_attempt_count", server_default=None)
    op.alter_column("import_jobs", "next_dispatch_at", server_default=None)
    op.create_index(
        "idx_import_jobs_dispatch_due",
        "import_jobs",
        ["dispatch_status", "next_dispatch_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_import_jobs_dispatch_due", table_name="import_jobs")
    op.drop_constraint(
        "ck_import_jobs_dispatch_attempt_count",
        "import_jobs",
        type_="check",
    )
    op.drop_column("import_jobs", "dispatch_error")
    op.drop_column("import_jobs", "dispatch_completed_at")
    op.drop_column("import_jobs", "dispatch_started_at")
    op.drop_column("import_jobs", "dispatched_at")
    op.drop_column("import_jobs", "next_dispatch_at")
    op.drop_column("import_jobs", "dispatch_attempt_count")
    op.drop_column("import_jobs", "dispatch_status")
    sa.Enum(name="importdispatchstatus").drop(op.get_bind(), checkfirst=True)
