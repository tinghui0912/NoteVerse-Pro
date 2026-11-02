"""Create canonical Practice sources and independently owned performance media."""

from alembic import op
import sqlalchemy as sa

revision = "0053_practice_source_takes"
down_revision = "0052_practice_step_verifier_provider"
branch_labels = None
depends_on = None

RETIRED_PRACTICE_ENUMS = (
    "practicereplayobjectdeletionstatus",
    "practicereplayartifactkind",
    "practiceattemptresolutionreason",
    "practiceattemptcompletionstatus",
    "practiceattemptresult",
    "practicestepmicrophoneverificationprovider",
    "practicesessionsummarystatus",
    "practicesessioncompletionreason",
    "practiceinputsource",
    "practiceevaluationprofile",
    "practicerealtimeguidance",
    "practiceprogressionmode",
    "practicesessionstate",
)


def upgrade() -> None:
    op.drop_table("practice_replay_object_deletion_outbox", if_exists=True)
    op.drop_table("practice_replay_artifacts", if_exists=True)
    op.drop_table("practice_attempts", if_exists=True)
    op.drop_table("practice_sessions", if_exists=True)
    for enum_name in RETIRED_PRACTICE_ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")

    op.create_table(
        "practice_sources",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column(
            "live_revision_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True
        ),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("source_score_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_revision_uuid", sa.String(length=36), nullable=False),
        sa.Column("artifact_id", sa.String(length=128), nullable=False),
        sa.Column("artifact_schema_version", sa.Integer(), nullable=False),
        sa.Column("prepared_musicxml_object_key", sa.String(length=768), nullable=False),
        sa.Column("prepared_musicxml_sha256", sa.String(length=64), nullable=False),
        sa.Column("prepared_musicxml_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("artifact_object_key", sa.String(length=768), nullable=False),
        sa.Column("artifact_sha256", sa.String(length=64), nullable=False),
        sa.Column("artifact_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("creation_expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "(status = 'CREATING' AND creation_expires_at IS NOT NULL) OR (status IN ('READY', 'DELETING') AND creation_expires_at IS NULL)",
            name="ck_practice_sources_creation_lease",
        ),
        sa.CheckConstraint(
            "status IN ('CREATING', 'READY', 'DELETING')", name="ck_practice_sources_status"
        ),
        sa.ForeignKeyConstraint(
            ["live_revision_id"],
            ["score_revisions.id"],
            name="fk_practice_sources_live_revision",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_object_key", name="uq_practice_sources_artifact_key"),
        sa.UniqueConstraint(
            "prepared_musicxml_object_key", name="uq_practice_sources_musicxml_key"
        ),
        sa.UniqueConstraint("source_id", name="uq_practice_sources_source_id"),
    )
    op.create_index(
        op.f("ix_practice_sources_live_revision_id"),
        "practice_sources",
        ["live_revision_id"],
        unique=False,
    )
    op.create_index(
        "ix_practice_sources_source_score_revision",
        "practice_sources",
        ["source_score_uuid", "source_revision_uuid"],
        unique=False,
    )
    op.create_index(
        "ix_practice_sources_status_creation",
        "practice_sources",
        ["status", "creation_expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_practice_sources_status_owner",
        "practice_sources",
        ["status", "live_revision_id"],
        unique=False,
    )
    op.create_table(
        "performance_take_upload_reservations",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("reservation_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("source_score_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_revision_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_artifact_id", sa.String(length=128), nullable=False),
        sa.Column("client_request_id", sa.String(length=128), nullable=False),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column(
            "linked_score_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True
        ),
        sa.Column("score_title_snapshot", sa.String(length=255), nullable=False),
        sa.Column("scope_type", sa.String(length=16), nullable=False),
        sa.Column("scope_start_beat", sa.Float(), nullable=False),
        sa.Column("scope_terminal_beat", sa.Float(), nullable=False),
        sa.Column("scope_start_group_id", sa.String(length=128), nullable=True),
        sa.Column("scope_end_group_id", sa.String(length=128), nullable=True),
        sa.Column("tempo_plan", sa.Text(), nullable=False),
        sa.Column("recording_timebase", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("media_kind", sa.String(length=16), nullable=False),
        sa.Column("media_mime_type", sa.String(length=64), nullable=False),
        sa.Column("media_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("staging_object_key", sa.String(length=768), nullable=False),
        sa.Column("storage_reservation_id", sa.String(length=36), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_put_url_expires_at", sa.DateTime(), nullable=True),
        sa.Column("staging_cleanup_after", sa.DateTime(), nullable=True),
        sa.Column("staging_cleanup_completed_at", sa.DateTime(), nullable=True),
        sa.Column("finalizing_object_key", sa.String(length=768), nullable=True),
        sa.Column("orphan_final_object_keys", sa.Text(), nullable=False),
        sa.Column("finalizing_token", sa.String(length=36), nullable=True),
        sa.Column("finalizing_expires_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "(status = 'FINALIZING' AND finalizing_token IS NOT NULL AND finalizing_object_key IS NOT NULL AND finalizing_expires_at IS NOT NULL) OR (status != 'FINALIZING' AND finalizing_token IS NULL AND finalizing_object_key IS NULL AND finalizing_expires_at IS NULL)",
            name="ck_take_reservation_finalize_lease",
        ),
        sa.CheckConstraint(
            "status IN ('RESERVED','FINALIZING','COMPLETED','CANCELLED','EXPIRED')",
            name="ck_take_reservation_status",
        ),
        sa.ForeignKeyConstraint(
            ["linked_score_id"],
            ["scores.id"],
            name="fk_take_upload_reservation_linked_score",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "client_request_id", name="uq_take_upload_reservation_user_client_request_id"
        ),
    )
    op.create_index(
        op.f("ix_performance_take_upload_reservations_client_request_id"),
        "performance_take_upload_reservations",
        ["client_request_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_take_upload_reservations_linked_score_id"),
        "performance_take_upload_reservations",
        ["linked_score_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_take_upload_reservations_reservation_uuid"),
        "performance_take_upload_reservations",
        ["reservation_uuid"],
        unique=True,
    )
    op.create_index(
        op.f("ix_performance_take_upload_reservations_storage_reservation_id"),
        "performance_take_upload_reservations",
        ["storage_reservation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_take_upload_reservations_take_uuid"),
        "performance_take_upload_reservations",
        ["take_uuid"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_take_upload_reservations_user_id"),
        "performance_take_upload_reservations",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_take_upload_reservation_status_expires",
        "performance_take_upload_reservations",
        ["status", "expires_at"],
        unique=False,
    )
    op.create_table(
        "performance_takes",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("source_score_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_revision_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_artifact_id", sa.String(length=128), nullable=False),
        sa.Column(
            "linked_score_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True
        ),
        sa.Column("score_title_snapshot", sa.String(length=255), nullable=False),
        sa.Column(
            "upload_reservation_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=False,
        ),
        sa.Column(
            "media_kind", sa.Enum("AUDIO", "VIDEO", name="performancetakemediakind"), nullable=False
        ),
        sa.Column("media_mime_type", sa.String(length=64), nullable=False),
        sa.Column("media_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("media_object_key", sa.String(length=768), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("scope_type", sa.String(length=16), nullable=False),
        sa.Column("scope_start_beat", sa.Float(), nullable=False),
        sa.Column("scope_terminal_beat", sa.Float(), nullable=False),
        sa.Column("scope_start_group_id", sa.String(length=128), nullable=True),
        sa.Column("scope_end_group_id", sa.String(length=128), nullable=True),
        sa.Column("tempo_plan", sa.Text(), nullable=False),
        sa.Column("recording_timebase", sa.Text(), nullable=False),
        sa.Column("deletion_status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "deletion_status IN ('ACTIVE','DELETING')", name="ck_performance_takes_deletion_status"
        ),
        sa.CheckConstraint(
            "media_kind IN ('AUDIO','VIDEO')", name="ck_performance_takes_media_kind"
        ),
        sa.CheckConstraint(
            "scope_type IN ('FULL','RANGE')", name="ck_performance_takes_scope_type"
        ),
        sa.ForeignKeyConstraint(["linked_score_id"], ["scores.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["upload_reservation_id"],
            ["performance_take_upload_reservations.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "upload_reservation_id", name="uq_performance_takes_upload_reservation"
        ),
    )
    op.create_index(
        op.f("ix_performance_takes_linked_score_id"),
        "performance_takes",
        ["linked_score_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_takes_media_object_key"),
        "performance_takes",
        ["media_object_key"],
        unique=True,
    )
    op.create_index(
        op.f("ix_performance_takes_take_uuid"), "performance_takes", ["take_uuid"], unique=True
    )
    op.create_index(
        "ix_performance_takes_user_created",
        "performance_takes",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_performance_takes_user_deletion_status",
        "performance_takes",
        ["user_id", "deletion_status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_takes_user_id"), "performance_takes", ["user_id"], unique=False
    )
    op.create_table(
        "performance_take_delete_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("take_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("media_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["take_id"], ["performance_takes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_performance_take_delete_outbox_outbox_uuid"),
        "performance_take_delete_outbox",
        ["outbox_uuid"],
        unique=True,
    )
    op.create_index(
        op.f("ix_performance_take_delete_outbox_take_id"),
        "performance_take_delete_outbox",
        ["take_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_take_delete_outbox_take_uuid"),
        "performance_take_delete_outbox",
        ["take_uuid"],
        unique=True,
    )
    op.create_index(
        op.f("ix_performance_take_delete_outbox_user_id"),
        "performance_take_delete_outbox",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_take_delete_outbox_status_next_attempt",
        "performance_take_delete_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_table(
        "practice_source_delete_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column(
            "practice_source_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=True,
        ),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("prepared_musicxml_object_key", sa.String(length=768), nullable=False),
        sa.Column("artifact_object_key", sa.String(length=768), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED')",
            name="ck_practice_source_delete_status",
        ),
        sa.ForeignKeyConstraint(
            ["practice_source_id"],
            ["practice_sources.id"],
            name="fk_practice_source_delete_source",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_uuid", name="uq_practice_source_delete_outbox_uuid"),
    )
    op.create_index(
        op.f("ix_practice_source_delete_outbox_practice_source_id"),
        "practice_source_delete_outbox",
        ["practice_source_id"],
        unique=False,
    )
    op.create_index(
        "ix_practice_source_delete_source_id",
        "practice_source_delete_outbox",
        ["source_id"],
        unique=False,
    )
    op.create_index(
        "ix_practice_source_delete_status_next",
        "practice_source_delete_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    for table in ("score_share_grants", "score_publications"):
        op.add_column(
            table,
            sa.Column("access_mode", sa.String(16), nullable=False, server_default="PRACTICE"),
        )
        op.execute(
            sa.text(
                f"UPDATE {table} SET access_mode = CASE WHEN allow_practice THEN 'PRACTICE' ELSE 'VIEW' END"
            )
        )
        op.drop_column(table, "allow_practice")
        op.create_check_constraint(
            f"ck_{table}_access_mode", table, "access_mode IN ('VIEW', 'PRACTICE')"
        )


def downgrade() -> None:
    raise RuntimeError("Practice foundation schema is not reversible.")
