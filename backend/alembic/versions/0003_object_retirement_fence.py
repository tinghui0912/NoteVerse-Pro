"""Fence reference reacquisition across uncertain physical deletion outcomes."""

from alembic import op
import sqlalchemy as sa

revision = "0003_object_retirement_fence"
down_revision = "0002_storage_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stored_object_retirements",
        sa.Column("deletion_fenced_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Attempted, unfinished work may already have deleted bytes without a DB acknowledgement.
    # Fence those rows now; their durable retry resolves physical absence idempotently.
    op.execute(
        "UPDATE stored_object_retirements SET deletion_fenced_at=CURRENT_TIMESTAMP WHERE attempt_count>0 AND status NOT IN ('CANCELLED','COMPLETED')"
    )
    op.create_check_constraint(
        "ck_object_retirement_deletion_fence",
        "stored_object_retirements",
        "deletion_fenced_at IS NULL OR status <> 'CANCELLED'",
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS(SELECT 1 FROM stored_object_retirements WHERE deletion_fenced_at IS NOT NULL AND status <> 'COMPLETED')"
        )
    ):
        raise RuntimeError("Unfinished physical deletion fences must complete before downgrade")
    op.drop_constraint(
        "ck_object_retirement_deletion_fence", "stored_object_retirements", type_="check"
    )
    op.drop_column("stored_object_retirements", "deletion_fenced_at")
