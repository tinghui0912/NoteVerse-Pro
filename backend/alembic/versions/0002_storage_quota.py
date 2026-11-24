"""Separate durable quota holds from committed logical usage."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_storage_quota"
down_revision = "0001_current_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    # Lock lineage against concurrent protocol writes during the schema change.
    connection.execute(
        sa.text(
            "LOCK TABLE storage_usage_reservations, performance_take_upload_reservations IN ACCESS EXCLUSIVE MODE"
        )
    )
    invalid = connection.scalar(
        sa.text("""
        SELECT count(*) FROM performance_take_upload_reservations b
        LEFT JOIN storage_usage_reservations r ON r.reservation_uuid=b.storage_reservation_id
        JOIN performance_take_manifests m ON m.id=b.manifest_id
        WHERE r.id IS NULL OR r.user_id<>b.user_id OR r.category<>'UPLOAD'
        OR NOT r.counts_toward_quota_snapshot OR r.bytes_reserved<=0
        OR (m.manifest_json::jsonb #>> '{manifest,capture,byte_size}') IS NULL
        OR r.bytes_reserved<>(m.manifest_json::jsonb #>> '{manifest,capture,byte_size}')::bigint
        OR b.expires_at<=r.created_at
        OR (b.status='COMPLETED' AND r.status<>'COMMITTED')
        OR (b.status IN ('CANCELLED','EXPIRED') AND r.status<>'RELEASED')
        OR (b.status IN ('RESERVED','FINALIZING') AND r.status<>'RESERVED')
        OR (r.status='COMMITTED' AND r.updated_at>=b.expires_at)
    """)
    )
    duplicate = connection.scalar(
        sa.text(
            "SELECT count(*) FROM (SELECT storage_reservation_id FROM performance_take_upload_reservations GROUP BY storage_reservation_id HAVING count(*)<>1) x"
        )
    )
    unbound = connection.scalar(
        sa.text("""SELECT count(*) FROM storage_usage_reservations r
        WHERE r.status='RESERVED' AND NOT EXISTS (SELECT 1 FROM performance_take_upload_reservations b WHERE b.storage_reservation_id=r.reservation_uuid)""")
    )
    if invalid or duplicate or unbound:
        raise RuntimeError(
            "Quota migration requires unambiguous Take reservation lineage and no unbound active capacity reservations"
        )
    op.drop_constraint(
        "ck_storage_plan_policies_default_limit_non_negative",
        "storage_plan_policies",
        type_="check",
    )
    op.add_column("storage_plan_policies", sa.Column("mode", sa.String(16), nullable=True))
    op.execute("UPDATE storage_plan_policies SET mode='HARD_LIMIT'")
    op.alter_column("storage_plan_policies", "mode", nullable=False)
    op.alter_column("storage_plan_policies", "default_limit_bytes", nullable=True)
    op.create_check_constraint(
        "ck_storage_plan_policies_mode_limit",
        "storage_plan_policies",
        "(mode = 'HARD_LIMIT' AND default_limit_bytes IS NOT NULL AND default_limit_bytes >= 0) OR (mode = 'UNLIMITED' AND default_limit_bytes IS NULL)",
    )
    op.drop_constraint(
        "ck_user_storage_entitlements_override_non_negative",
        "user_storage_entitlements",
        type_="check",
    )
    op.add_column(
        "user_storage_entitlements", sa.Column("mode_override", sa.String(16), nullable=True)
    )
    op.execute(
        "UPDATE user_storage_entitlements SET mode_override='HARD_LIMIT' WHERE limit_override_bytes IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_user_storage_entitlements_mode_limit",
        "user_storage_entitlements",
        "(mode_override IS NULL AND limit_override_bytes IS NULL) OR (mode_override IS NOT NULL AND mode_override = 'HARD_LIMIT' AND limit_override_bytes IS NOT NULL AND limit_override_bytes >= 0) OR (mode_override IS NOT NULL AND mode_override = 'UNLIMITED' AND limit_override_bytes IS NULL)",
    )
    op.create_table(
        "storage_quota_holds",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("hold_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("command_key", sa.String(160), nullable=False),
        sa.Column(
            "category",
            postgresql.ENUM(name="storageusagecategory", create_type=False),
            nullable=False,
        ),
        sa.Column("bytes_held", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.Column("expired_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "command_key", name="uq_storage_quota_holds_user_command"),
        sa.CheckConstraint("bytes_held > 0", name="ck_storage_quota_holds_positive_bytes"),
        sa.CheckConstraint(
            "category IN ('SOURCE', 'UPLOAD', 'INPUT_ASSET')",
            name="ck_storage_quota_holds_category",
        ),
        sa.CheckConstraint("expires_at > created_at", name="ck_storage_quota_holds_expiry"),
        sa.CheckConstraint(
            "(status = 'HELD' AND consumed_at IS NULL AND released_at IS NULL AND expired_at IS NULL) OR (status = 'CONSUMED' AND consumed_at IS NOT NULL AND consumed_at < expires_at AND released_at IS NULL AND expired_at IS NULL) OR (status = 'RELEASED' AND released_at IS NOT NULL AND consumed_at IS NULL AND expired_at IS NULL) OR (status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at AND consumed_at IS NULL AND released_at IS NULL)",
            name="ck_storage_quota_holds_lifecycle",
        ),
    )
    op.create_index(
        "idx_storage_quota_holds_user_status_expiry",
        "storage_quota_holds",
        ["user_id", "status", "expires_at"],
    )
    op.create_index(
        "idx_storage_quota_holds_status_expiry",
        "storage_quota_holds",
        ["status", "expires_at", "id"],
    )
    op.execute("""INSERT INTO storage_quota_holds (hold_uuid,user_id,command_key,category,bytes_held,status,expires_at,created_at,updated_at,consumed_at,released_at,expired_at)
        SELECT r.reservation_uuid,r.user_id,'take:'||b.client_request_id,r.category,r.bytes_reserved,
        CASE WHEN r.status='COMMITTED' THEN 'CONSUMED' WHEN r.status='RELEASED' THEN 'RELEASED' WHEN b.expires_at<=CURRENT_TIMESTAMP THEN 'EXPIRED' ELSE 'HELD' END,
        b.expires_at,r.created_at,r.updated_at,
        CASE WHEN r.status='COMMITTED' THEN r.updated_at END,
        CASE WHEN r.status='RELEASED' THEN r.updated_at END,
        CASE WHEN r.status='RESERVED' AND b.expires_at<=CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP END
        FROM performance_take_upload_reservations b JOIN storage_usage_reservations r ON r.reservation_uuid=b.storage_reservation_id""")
    op.add_column(
        "performance_take_upload_reservations",
        sa.Column("quota_hold_id", sa.BigInteger(), nullable=True),
    )
    op.execute(
        "UPDATE performance_take_upload_reservations b SET quota_hold_id=h.id FROM storage_quota_holds h WHERE h.hold_uuid=b.storage_reservation_id"
    )
    op.alter_column("performance_take_upload_reservations", "quota_hold_id", nullable=False)
    op.create_foreign_key(
        "fk_take_upload_quota_hold",
        "performance_take_upload_reservations",
        "storage_quota_holds",
        ["quota_hold_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_take_upload_quota_hold", "performance_take_upload_reservations", ["quota_hold_id"]
    )
    op.drop_index(
        "ix_performance_take_upload_reservations_storage_reservation_id",
        table_name="performance_take_upload_reservations",
    )
    op.drop_column("performance_take_upload_reservations", "storage_reservation_id")
    op.drop_table("storage_usage_reservations")
    postgresql.ENUM(name="storageusagereservationstatus").drop(connection)
    for table in ("storage_usage_accounts", "storage_usage_counters"):
        op.drop_constraint("ck_" + table + "_reserved_non_negative", table, type_="check")
        op.drop_column(table, "reserved_bytes")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM storage_plan_policies WHERE mode='UNLIMITED') OR EXISTS (SELECT 1 FROM user_storage_entitlements WHERE mode_override='UNLIMITED')"
        )
    ):
        raise RuntimeError("Unlimited quota has no finite predecessor representation")
    postgresql.ENUM(
        "RESERVED", "COMMITTED", "RELEASED", name="storageusagereservationstatus"
    ).create(connection)
    op.create_table(
        "storage_usage_reservations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("reservation_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "category",
            postgresql.ENUM(name="storageusagecategory", create_type=False),
            nullable=False,
        ),
        sa.Column("bytes_reserved", sa.BigInteger(), nullable=False),
        sa.Column("counts_toward_quota_snapshot", sa.Boolean(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="storageusagereservationstatus", create_type=False),
            nullable=False,
        ),
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column("object_type", sa.String(64)),
        sa.Column("object_id", sa.String(128)),
        sa.Column("storage_key", sa.String(768)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "bytes_reserved >= 0", name="ck_storage_usage_reservations_bytes_non_negative"
        ),
    )
    op.create_index(
        "idx_storage_usage_reservations_user_status",
        "storage_usage_reservations",
        ["user_id", "status"],
    )
    op.execute("""INSERT INTO storage_usage_reservations (reservation_uuid,user_id,category,bytes_reserved,counts_toward_quota_snapshot,status,reason,created_at,updated_at)
        SELECT hold_uuid,user_id,category,bytes_held,true,
        (CASE WHEN status='CONSUMED' THEN 'COMMITTED' WHEN status IN ('HELD','EXPIRED') AND EXISTS (SELECT 1 FROM performance_take_upload_reservations b WHERE b.quota_hold_id=storage_quota_holds.id AND b.status IN ('RESERVED','FINALIZING')) THEN 'RESERVED' WHEN status='HELD' AND expires_at>CURRENT_TIMESTAMP THEN 'RESERVED' ELSE 'RELEASED' END)::storageusagereservationstatus,
        'quota_hold',created_at,updated_at FROM storage_quota_holds""")
    op.add_column(
        "performance_take_upload_reservations",
        sa.Column("storage_reservation_id", sa.String(36), nullable=True),
    )
    op.execute(
        "UPDATE performance_take_upload_reservations b SET storage_reservation_id=h.hold_uuid FROM storage_quota_holds h WHERE h.id=b.quota_hold_id"
    )
    op.alter_column(
        "performance_take_upload_reservations", "storage_reservation_id", nullable=False
    )
    op.create_index(
        "ix_performance_take_upload_reservations_storage_reservation_id",
        "performance_take_upload_reservations",
        ["storage_reservation_id"],
    )
    op.drop_constraint(
        "fk_take_upload_quota_hold", "performance_take_upload_reservations", type_="foreignkey"
    )
    op.drop_constraint(
        "uq_take_upload_quota_hold", "performance_take_upload_reservations", type_="unique"
    )
    op.drop_column("performance_take_upload_reservations", "quota_hold_id")
    for table in ("storage_usage_accounts", "storage_usage_counters"):
        op.add_column(
            table, sa.Column("reserved_bytes", sa.BigInteger(), nullable=False, server_default="0")
        )
        op.alter_column(table, "reserved_bytes", server_default=None)
        op.create_check_constraint(
            "ck_" + table + "_reserved_non_negative", table, "reserved_bytes >= 0"
        )
    op.execute("""INSERT INTO storage_usage_counters(user_id, category, used_bytes, reserved_bytes, updated_at)
        SELECT user_id, category, 0, sum(bytes_reserved), CURRENT_TIMESTAMP
        FROM storage_usage_reservations WHERE status='RESERVED'
        GROUP BY user_id, category ON CONFLICT (user_id, category) DO NOTHING""")
    op.execute(
        "UPDATE storage_usage_accounts a SET reserved_bytes=COALESCE((SELECT sum(bytes_reserved) FROM storage_usage_reservations r WHERE r.user_id=a.user_id AND r.status='RESERVED'),0)"
    )
    op.execute(
        "UPDATE storage_usage_counters c SET reserved_bytes=COALESCE((SELECT sum(bytes_reserved) FROM storage_usage_reservations r WHERE r.user_id=c.user_id AND r.category=c.category AND r.status='RESERVED'),0)"
    )
    op.drop_table("storage_quota_holds")
    op.drop_constraint(
        "ck_storage_plan_policies_mode_limit", "storage_plan_policies", type_="check"
    )
    op.drop_column("storage_plan_policies", "mode")
    op.alter_column("storage_plan_policies", "default_limit_bytes", nullable=False)
    op.create_check_constraint(
        "ck_storage_plan_policies_default_limit_non_negative",
        "storage_plan_policies",
        "default_limit_bytes >= 0",
    )
    op.drop_constraint(
        "ck_user_storage_entitlements_mode_limit", "user_storage_entitlements", type_="check"
    )
    op.drop_column("user_storage_entitlements", "mode_override")
    op.create_check_constraint(
        "ck_user_storage_entitlements_override_non_negative",
        "user_storage_entitlements",
        "limit_override_bytes IS NULL OR limit_override_bytes >= 0",
    )
