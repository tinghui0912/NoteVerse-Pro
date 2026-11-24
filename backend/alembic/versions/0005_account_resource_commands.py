"""Account deletion ownership and idempotent Upload creation lineage."""

from alembic import op
import sqlalchemy as sa
import hashlib
import json

revision = "0005_account_resource_commands"
down_revision = "0004_finite_storage_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ordered original input identities are required to preserve submission replay.
    rows = (
        op.get_bind()
        .execute(
            sa.text("""SELECT j.id,j.requested_options,
      json_agg(u.upload_uuid ORDER BY l.sort_order,l.id) FILTER (WHERE u.id IS NOT NULL)
      FROM import_jobs j LEFT JOIN import_job_uploads l ON l.job_id=j.id
      LEFT JOIN uploads u ON u.id=l.upload_id WHERE j.idempotency_key IS NOT NULL
      GROUP BY j.id ORDER BY j.id""")
        )
        .all()
    )
    if any(not uploads for _, _, uploads in rows):
        raise RuntimeError(
            "Keyed Import submission has no original input lineage; resolve it explicitly before upgrading"
        )
    op.add_column("import_jobs", sa.Column("submission_fingerprint", sa.String(64), nullable=True))
    for job_id, options, uploads in rows:
        digest = hashlib.sha256(
            json.dumps(
                [uploads, options], sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest()
        op.get_bind().execute(
            sa.text("UPDATE import_jobs SET submission_fingerprint=:digest WHERE id=:id"),
            {"digest": digest, "id": job_id},
        )
    op.create_check_constraint(
        "ck_import_submission_identity",
        "import_jobs",
        "(idempotency_key IS NULL AND submission_fingerprint IS NULL) OR (idempotency_key IS NOT NULL AND submission_fingerprint IS NOT NULL)",
    )
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint(
        "fk_score_deletion_operations_owner_user_id_users",
        "score_deletion_operations",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_score_invites_terminal_actor_user_id_users", "score_invites", type_="foreignkey"
    )
    op.drop_constraint("notifications_actor_user_id_fkey", "notifications", type_="foreignkey")
    op.create_table(
        "upload_creation_requests",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("client_request_id", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column(
            "quota_hold_id",
            sa.BigInteger(),
            sa.ForeignKey("storage_quota_holds.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "upload_id",
            sa.BigInteger(),
            sa.ForeignKey("uploads.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "client_request_id", name="uq_upload_creation_user_request"),
        sa.CheckConstraint("generation > 0", name="ck_upload_creation_generation"),
        sa.CheckConstraint(
            "upload_id IS NULL OR completed_at IS NOT NULL", name="ck_upload_creation_completion"
        ),
    )
    op.create_table(
        "account_deletion_operations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("operation_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
        sa.Column("user_id_snapshot", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("phase", sa.String(16), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("attempt_token", sa.String(36), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("attempt_count >= 0", name="ck_account_deletion_attempts"),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_account_deletion_attempt_token",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','DISPATCHED','PROCESSING','FAILED','COMPLETED')",
            name="ck_account_deletion_status",
        ),
        sa.CheckConstraint(
            "phase IN ('SCORES','IMPORTS','TAKES','UPLOADS','FINALIZE')",
            name="ck_account_deletion_phase",
        ),
    )
    op.create_index(
        "ix_account_deletion_due", "account_deletion_operations", ["status", "next_attempt_at"]
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("""SELECT EXISTS(SELECT 1 FROM account_deletion_operations)
        OR EXISTS(SELECT 1 FROM upload_creation_requests)
        OR EXISTS(SELECT 1 FROM users WHERE deleted_at IS NOT NULL)
        OR EXISTS(SELECT 1 FROM score_invites i WHERE i.terminal_actor_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=i.terminal_actor_user_id))
        OR EXISTS(SELECT 1 FROM notifications n WHERE n.actor_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=n.actor_user_id))
        OR EXISTS(SELECT 1 FROM score_deletion_operations d WHERE NOT EXISTS(SELECT 1 FROM users u WHERE u.id=d.owner_user_id))""")
    ):
        raise RuntimeError(
            "Persisted account deletion or Upload idempotency lineage cannot be discarded by downgrade"
        )
    op.drop_table("account_deletion_operations")
    op.drop_table("upload_creation_requests")
    op.create_foreign_key(
        "fk_score_deletion_operations_owner_user_id_users",
        "score_deletion_operations",
        "users",
        ["owner_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_score_invites_terminal_actor_user_id_users",
        "score_invites",
        "users",
        ["terminal_actor_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "notifications_actor_user_id_fkey", "notifications", "users", ["actor_user_id"], ["id"]
    )
    op.drop_column("users", "deleted_at")
    op.drop_constraint("ck_import_submission_identity", "import_jobs", type_="check")
    op.drop_column("import_jobs", "submission_fingerprint")
