"""Structured, safe failure evidence for account erasure and physical retirement."""

from alembic import op
import sqlalchemy as sa

revision = "0006_erasure_failure_facts"
down_revision = "0005_account_resource_commands"
branch_labels = None
depends_on = None

TABLES = (
    ("account_deletion_operations", "account_deletion"),
    ("stored_object_retirements", "object_retirement"),
)


def upgrade() -> None:
    for table, prefix in TABLES:
        for name, kind in (
            ("failure_code", sa.String(128)),
            ("failure_stage", sa.String(64)),
            ("failure_classification", sa.String(32)),
            ("failure_retryable", sa.Boolean()),
        ):
            op.add_column(table, sa.Column(name, kind, nullable=True))
        # Preserve every operation/phase/lease/fence. Existing untyped failures require
        # operator review, rather than inventing a retry classification from raw text.
        op.execute(
            sa.text(f"""UPDATE {table} SET failure_code='{prefix}_review_required',
            failure_stage='recovery', failure_classification='system_error', failure_retryable=false,
            failure_detail='Existing delivery failure requires operator review.'
            WHERE status='FAILED' OR (failure_detail IS NOT NULL AND status IN ('PENDING','DISPATCHED','PROCESSING'))""")
        )
        op.create_check_constraint(
            f"ck_{prefix}_failure_facts",
            table,
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR "
            "(failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL "
            "AND failure_classification IN ('transient','permanent','user_error','system_error')))",
        )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS(SELECT 1 FROM ops_audit_events WHERE operation_kind IN ('account_deletion','stored_object_retirement'))"
        )
    ):
        raise RuntimeError(
            "Deletion operator audit evidence cannot be represented by the previous Ops contract"
        )
    for table, _ in TABLES:
        if op.get_bind().scalar(
            sa.text(f"SELECT EXISTS(SELECT 1 FROM {table} WHERE failure_code IS NOT NULL)")
        ):
            raise RuntimeError(
                "Structured deletion failure evidence cannot be discarded; resolve operations before downgrade"
            )
    for table, prefix in reversed(TABLES):
        op.drop_constraint(f"ck_{prefix}_failure_facts", table, type_="check")
        for name in (
            "failure_retryable",
            "failure_classification",
            "failure_stage",
            "failure_code",
        ):
            op.drop_column(table, name)
