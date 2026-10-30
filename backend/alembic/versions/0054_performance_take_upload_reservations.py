"""Establish immutable upload reservations and structural Take lineage."""

from alembic import op
import sqlalchemy as sa

revision = "0054_take_upload_reservations"
down_revision = "0053_practice_source_takes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table(
        "performance_take_upload_authorizations", "performance_take_upload_reservations"
    )
    table = "performance_take_upload_reservations"
    op.alter_column(table, "auth_uuid", new_column_name="reservation_uuid")
    op.alter_column(table, "reservation_id", new_column_name="storage_reservation_id")
    op.alter_column(table, "final_object_key", existing_type=sa.String(768), nullable=True)
    op.drop_constraint("ck_take_upload_auth_status", table, type_="check")
    op.alter_column(table, "status", server_default="RESERVED")
    op.execute(
        sa.text(
            f"UPDATE {table} SET status = CASE status WHEN 'AUTHORIZED' THEN 'RESERVED' WHEN 'ARCHIVED' THEN 'COMPLETED' ELSE status END"
        )
    )
    op.create_check_constraint(
        "ck_take_upload_reservation_status",
        table,
        "status IN ('RESERVED', 'FINALIZING', 'COMPLETED', 'CANCELLED', 'EXPIRED')",
    )
    for suffix in ["user", "snapshot", "score", "revision"]:
        op.execute(
            sa.text(
                f"ALTER TABLE {table} RENAME CONSTRAINT fk_take_upload_auth_{suffix} TO fk_take_upload_reservation_{suffix}"
            )
        )
    for prefix, suffix in [
        ("uq", "user_client_request_id"),
        ("ck", "scope_type"),
        ("ck", "media_kind"),
    ]:
        op.execute(
            sa.text(
                f"ALTER TABLE {table} RENAME CONSTRAINT {prefix}_take_upload_auth_{suffix} TO {prefix}_take_upload_reservation_{suffix}"
            )
        )
    for old_suffix, new_suffix in [
        ("auth_uuid", "reservation_uuid"),
        ("reservation_id", "storage_reservation_id"),
        *[
            (name, name)
            for name in [
                "user_id",
                "take_uuid",
                "status_expires",
                "cleanup_after",
                "finalizing_expires",
                "final_cleanup",
                "source_snapshot_id",
            ]
        ],
    ]:
        op.execute(
            sa.text(
                f"ALTER INDEX ix_take_upload_auth_{old_suffix} RENAME TO ix_take_upload_reservation_{new_suffix}"
            )
        )
    op.execute(
        sa.text(
            f"ALTER TABLE {table} RENAME CONSTRAINT performance_take_upload_authorizations_pkey TO performance_take_upload_reservations_pkey"
        )
    )
    op.execute(
        sa.text(
            "ALTER SEQUENCE performance_take_upload_authorizations_id_seq RENAME TO performance_take_upload_reservations_id_seq"
        )
    )
    op.add_column(
        "performance_takes", sa.Column("upload_reservation_id", sa.BigInteger(), nullable=True)
    )
    op.execute(
        sa.text("""
        UPDATE performance_takes t SET upload_reservation_id = r.id
        FROM performance_take_upload_reservations r
        WHERE t.user_id = r.user_id AND t.client_request_id = r.client_request_id
          AND t.take_uuid = r.take_uuid
    """)
    )
    # SET NOT NULL fails closed if a persisted Take lacks its producing reservation.
    op.alter_column("performance_takes", "upload_reservation_id", nullable=False)
    op.create_foreign_key(
        "fk_performance_takes_upload_reservation",
        "performance_takes",
        table,
        ["upload_reservation_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_performance_takes_upload_reservation", "performance_takes", ["upload_reservation_id"]
    )
    op.drop_constraint(
        "uq_performance_takes_user_client_request_id", "performance_takes", type_="unique"
    )
    op.drop_index("ix_performance_takes_client_request_id", table_name="performance_takes")
    op.drop_column("performance_takes", "client_request_id")


def downgrade() -> None:
    table = "performance_take_upload_reservations"
    op.add_column(
        "performance_takes", sa.Column("client_request_id", sa.String(128), nullable=True)
    )
    op.execute(
        sa.text("""UPDATE performance_takes t SET client_request_id = r.client_request_id
        FROM performance_take_upload_reservations r WHERE t.upload_reservation_id = r.id""")
    )
    op.alter_column("performance_takes", "client_request_id", nullable=False)
    op.create_unique_constraint(
        "uq_performance_takes_user_client_request_id",
        "performance_takes",
        ["user_id", "client_request_id"],
    )
    op.create_index(
        "ix_performance_takes_client_request_id", "performance_takes", ["client_request_id"]
    )
    op.drop_constraint(
        "fk_performance_takes_upload_reservation", "performance_takes", type_="foreignkey"
    )
    op.drop_constraint(
        "uq_performance_takes_upload_reservation", "performance_takes", type_="unique"
    )
    op.drop_column("performance_takes", "upload_reservation_id")
    op.drop_constraint("ck_take_upload_reservation_status", table, type_="check")
    op.alter_column(table, "status", server_default="AUTHORIZED")
    op.execute(
        sa.text(
            f"UPDATE {table} SET status = CASE status WHEN 'RESERVED' THEN 'AUTHORIZED' WHEN 'COMPLETED' THEN 'ARCHIVED' ELSE status END"
        )
    )
    op.create_check_constraint(
        "ck_take_upload_auth_status",
        table,
        "status IN ('AUTHORIZED', 'FINALIZING', 'ARCHIVED', 'CANCELLED', 'EXPIRED')",
    )
    for suffix in ["user", "snapshot", "score", "revision"]:
        op.execute(
            sa.text(
                f"ALTER TABLE {table} RENAME CONSTRAINT fk_take_upload_reservation_{suffix} TO fk_take_upload_auth_{suffix}"
            )
        )
    for prefix, suffix in [
        ("uq", "user_client_request_id"),
        ("ck", "scope_type"),
        ("ck", "media_kind"),
    ]:
        op.execute(
            sa.text(
                f"ALTER TABLE {table} RENAME CONSTRAINT {prefix}_take_upload_reservation_{suffix} TO {prefix}_take_upload_auth_{suffix}"
            )
        )
    for old_suffix, new_suffix in [
        ("reservation_uuid", "auth_uuid"),
        ("storage_reservation_id", "reservation_id"),
        *[
            (name, name)
            for name in [
                "user_id",
                "take_uuid",
                "status_expires",
                "cleanup_after",
                "finalizing_expires",
                "final_cleanup",
                "source_snapshot_id",
            ]
        ],
    ]:
        op.execute(
            sa.text(
                f"ALTER INDEX ix_take_upload_reservation_{old_suffix} RENAME TO ix_take_upload_auth_{new_suffix}"
            )
        )
    op.execute(
        sa.text(
            f"ALTER TABLE {table} RENAME CONSTRAINT performance_take_upload_reservations_pkey TO performance_take_upload_authorizations_pkey"
        )
    )
    op.execute(
        sa.text(
            "ALTER SEQUENCE performance_take_upload_reservations_id_seq RENAME TO performance_take_upload_authorizations_id_seq"
        )
    )
    op.alter_column(table, "reservation_uuid", new_column_name="auth_uuid")
    op.alter_column(table, "storage_reservation_id", new_column_name="reservation_id")
    op.execute(
        sa.text(
            f"UPDATE {table} SET final_object_key = staging_object_key WHERE final_object_key IS NULL"
        )
    )
    op.alter_column(table, "final_object_key", existing_type=sa.String(768), nullable=False)
    op.rename_table(table, "performance_take_upload_authorizations")
