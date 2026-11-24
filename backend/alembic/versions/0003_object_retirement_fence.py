"""Fence reference reacquisition across uncertain physical deletion outcomes."""

from alembic import op
import sqlalchemy as sa

revision = "0003_object_retirement_fence"
down_revision = "0002_storage_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Stop concurrent retirement transitions between preflight and schema installation.
    # A cancelled attempt may have deleted bytes before its completion transaction rolled back.
    op.execute("LOCK TABLE stored_object_retirements IN ACCESS EXCLUSIVE MODE")
    ambiguous = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT retirement_uuid, stored_object_id, object_key, attempt_count, "
                "count(*) OVER () AS total FROM stored_object_retirements "
                "WHERE status='CANCELLED' AND attempt_count>0 ORDER BY id LIMIT 20"
            )
        )
        .mappings()
        .all()
    )
    if ambiguous:
        records = "; ".join(
            f"{row['retirement_uuid']} (object={row['stored_object_id']}, "
            f"key={row['object_key']!r}, attempts={row['attempt_count']})"
            for row in ambiguous
        )
        raise RuntimeError(
            f"Ambiguous CANCELLED retirement attempts: {ambiguous[0]['total']} record(s); "
            f"first {len(ambiguous)}: {records}. Upgrade stopped before schema changes. "
            "Quiesce writers/workers and explicitly reconcile physical bytes, all semantic "
            "references and accounting per docs/architecture/object-storage.md "
            "(Migration preflight and operator reconciliation). Do not reset attempt_count."
        )
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
