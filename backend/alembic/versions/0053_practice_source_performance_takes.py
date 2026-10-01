"""Create final performance take and practice source snapshot schema.

Revision ID: 0053_practice_source_takes
Revises: 0052_practice_step_verifier_provider
"""

from __future__ import annotations

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0053_practice_source_takes"
down_revision: str | Sequence[str] | None = "0052_practice_step_verifier_provider"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


LEGACY_PRACTICE_ENUMS = (
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

media_kind_enum = postgresql.ENUM(
    "AUDIO",
    "VIDEO",
    name="performancetakemediakind",
    create_type=False,
)


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        media_kind_enum.create(bind, checkfirst=True)

    op.drop_table("practice_replay_object_deletion_outbox", if_exists=True)
    op.drop_table("practice_replay_artifacts", if_exists=True)
    op.drop_table("practice_attempts", if_exists=True)
    op.drop_table("practice_sessions", if_exists=True)
    for enum_name in LEGACY_PRACTICE_ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")

    op.create_table(
        "practice_source_snapshots",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("snapshot_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_fingerprint", sa.String(length=128), nullable=False),
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
        sa.Column("status", sa.String(length=16), nullable=False, server_default="READY"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("snapshot_uuid", name="uq_practice_source_snapshots_uuid"),
        sa.UniqueConstraint("source_fingerprint", name="uq_practice_source_snapshots_fingerprint"),
        sa.UniqueConstraint("prepared_musicxml_object_key", name="uq_practice_source_snapshots_musicxml_key"),
        sa.UniqueConstraint("artifact_object_key", name="uq_practice_source_snapshots_artifact_key"),
        sa.CheckConstraint("status IN ('CREATING', 'READY', 'DELETING')", name="ck_practice_source_snapshots_status"),
    )
    op.create_index(
        "ix_practice_source_snapshots_source_score_revision",
        "practice_source_snapshots",
        ["source_score_uuid", "source_revision_uuid"],
    )

    op.create_table(
        "performance_takes",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("source_snapshot_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("linked_score_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("score_title_snapshot", sa.String(length=255), nullable=False),
        sa.Column("client_request_id", sa.String(length=128), nullable=False),
        sa.Column(
            "media_kind",
            media_kind_enum if bind.dialect.name == "postgresql" else sa.String(length=16),
            nullable=False,
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
        sa.Column("deletion_status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_perf_takes_user", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_snapshot_id"], ["practice_source_snapshots.id"], name="fk_perf_takes_snapshot", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["linked_score_id"], ["scores.id"], name="fk_perf_takes_linked_score", ondelete="SET NULL"),
        sa.UniqueConstraint("user_id", "client_request_id", name="uq_performance_takes_user_client_request_id"),
        sa.CheckConstraint("deletion_status IN ('ACTIVE', 'DELETING')", name="ck_performance_takes_deletion_status"),
        sa.CheckConstraint("scope_type IN ('FULL', 'RANGE')", name="ck_performance_takes_scope_type"),
        sa.CheckConstraint("media_kind IN ('AUDIO', 'VIDEO')", name="ck_performance_takes_media_kind"),
    )
    op.create_index("ix_performance_takes_take_uuid", "performance_takes", ["take_uuid"], unique=True)
    op.create_index("ix_performance_takes_user_id", "performance_takes", ["user_id"])
    op.create_index("ix_performance_takes_linked_score_id", "performance_takes", ["linked_score_id"])
    op.create_index("ix_performance_takes_client_request_id", "performance_takes", ["client_request_id"])
    op.create_index("ix_performance_takes_media_object_key", "performance_takes", ["media_object_key"], unique=True)
    op.create_index("ix_performance_takes_user_created", "performance_takes", ["user_id", "created_at"])
    op.create_index("ix_performance_takes_user_deletion_status", "performance_takes", ["user_id", "deletion_status"])
    op.create_index("ix_performance_takes_source_snapshot_id", "performance_takes", ["source_snapshot_id"])

    op.create_table(
        "performance_take_upload_authorizations",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("auth_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("source_snapshot_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("client_request_id", sa.String(length=128), nullable=False),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("score_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_title", sa.String(length=255), nullable=False),
        sa.Column("revision_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("revision_uuid", sa.String(length=36), nullable=False),
        sa.Column("artifact_id", sa.String(length=128), nullable=False),
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
        sa.Column("final_object_key", sa.String(length=768), nullable=False),
        sa.Column("reservation_id", sa.String(length=36), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_put_url_expires_at", sa.DateTime(), nullable=True),
        sa.Column("staging_cleanup_after", sa.DateTime(), nullable=True),
        sa.Column("staging_cleanup_completed_at", sa.DateTime(), nullable=True),
        sa.Column("final_cleanup_completed_at", sa.DateTime(), nullable=True),
        sa.Column("finalizing_object_key", sa.String(length=768), nullable=True),
        sa.Column("orphan_final_object_keys", sa.Text(), nullable=True),
        sa.Column("finalizing_token", sa.String(length=36), nullable=True),
        sa.Column("finalizing_expires_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="AUTHORIZED"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_take_upload_auth_user", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_snapshot_id"], ["practice_source_snapshots.id"], name="fk_take_upload_auth_snapshot", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], name="fk_take_upload_auth_score", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], name="fk_take_upload_auth_revision", ondelete="SET NULL"),
        sa.UniqueConstraint("user_id", "client_request_id", name="uq_take_upload_auth_user_client_request_id"),
        sa.CheckConstraint("status IN ('AUTHORIZED', 'FINALIZING', 'ARCHIVED', 'CANCELLED', 'EXPIRED')", name="ck_take_upload_auth_status"),
        sa.CheckConstraint("scope_type IN ('FULL', 'RANGE')", name="ck_take_upload_auth_scope_type"),
        sa.CheckConstraint("media_kind IN ('AUDIO', 'VIDEO')", name="ck_take_upload_auth_media_kind"),
    )
    op.create_index("ix_take_upload_auth_auth_uuid", "performance_take_upload_authorizations", ["auth_uuid"], unique=True)
    op.create_index("ix_take_upload_auth_user_id", "performance_take_upload_authorizations", ["user_id"])
    op.create_index("ix_take_upload_auth_take_uuid", "performance_take_upload_authorizations", ["take_uuid"])
    op.create_index("ix_take_upload_auth_reservation_id", "performance_take_upload_authorizations", ["reservation_id"])
    op.create_index("ix_take_upload_auth_status_expires", "performance_take_upload_authorizations", ["status", "expires_at"])
    op.create_index("ix_take_upload_auth_cleanup_after", "performance_take_upload_authorizations", ["staging_cleanup_completed_at", "staging_cleanup_after"])
    op.create_index("ix_take_upload_auth_finalizing_expires", "performance_take_upload_authorizations", ["status", "finalizing_expires_at"])
    op.create_index("ix_take_upload_auth_final_cleanup", "performance_take_upload_authorizations", ["final_cleanup_completed_at", "status"])
    op.create_index("ix_take_upload_auth_source_snapshot_id", "performance_take_upload_authorizations", ["source_snapshot_id"])

    op.create_table(
        "performance_take_delete_outbox",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("take_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("media_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="PENDING"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["take_id"], ["performance_takes.id"], name="fk_take_delete_outbox_take", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_take_delete_outbox_user", ondelete="CASCADE"),
        sa.CheckConstraint("status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED')", name="ck_take_delete_outbox_status"),
    )
    op.create_index("ix_take_delete_outbox_outbox_uuid", "performance_take_delete_outbox", ["outbox_uuid"], unique=True)
    op.create_index("ix_take_delete_outbox_take_uuid", "performance_take_delete_outbox", ["take_uuid"], unique=True)
    op.create_index("ix_take_delete_outbox_user_id", "performance_take_delete_outbox", ["user_id"])
    op.create_index("ix_take_delete_outbox_status_next_attempt", "performance_take_delete_outbox", ["status", "next_attempt_at"])

    op.create_table(
        "practice_source_snapshot_delete_outbox",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_snapshot_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("snapshot_uuid", sa.String(length=36), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("prepared_musicxml_object_key", sa.String(length=768), nullable=False),
        sa.Column("artifact_object_key", sa.String(length=768), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="PENDING"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["source_snapshot_id"], ["practice_source_snapshots.id"], name="fk_source_snapshot_delete_outbox_snapshot", ondelete="SET NULL"),
        sa.UniqueConstraint("outbox_uuid", name="uq_source_snapshot_delete_outbox_uuid"),
        sa.CheckConstraint("status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED')", name="ck_source_snapshot_delete_status"),
    )
    op.create_index("ix_source_snapshot_delete_status_next", "practice_source_snapshot_delete_outbox", ["status", "next_attempt_at"])
    op.create_index("ix_source_snapshot_delete_snapshot_uuid", "practice_source_snapshot_delete_outbox", ["snapshot_uuid"])

    if _has_table("score_share_grants"):
        columns = _columns("score_share_grants")
        if "access_mode" not in columns:
            op.add_column(
                "score_share_grants",
                sa.Column("access_mode", sa.String(length=16), nullable=False, server_default="PRACTICE"),
            )
            if "allow_practice" in columns:
                op.execute(
                    sa.text(
                        "UPDATE score_share_grants SET access_mode = CASE WHEN allow_practice THEN 'PRACTICE' ELSE 'VIEW' END"
                    )
                )
        if "allow_practice" in _columns("score_share_grants"):
            op.drop_column("score_share_grants", "allow_practice")
        with op.batch_alter_table("score_share_grants") as batch_op:
            batch_op.create_check_constraint(
                "ck_score_share_grants_access_mode",
                "access_mode IN ('VIEW', 'PRACTICE')",
            )

    if _has_table("score_publications"):
        columns = _columns("score_publications")
        if "access_mode" not in columns:
            op.add_column(
                "score_publications",
                sa.Column("access_mode", sa.String(length=16), nullable=False, server_default="PRACTICE"),
            )
            if "allow_practice" in columns:
                op.execute(
                    sa.text(
                        "UPDATE score_publications SET access_mode = CASE WHEN allow_practice THEN 'PRACTICE' ELSE 'VIEW' END"
                    )
                )
        if "allow_practice" in _columns("score_publications"):
            op.drop_column("score_publications", "allow_practice")
        with op.batch_alter_table("score_publications") as batch_op:
            batch_op.create_check_constraint(
                "ck_score_publications_access_mode",
                "access_mode IN ('VIEW', 'PRACTICE')",
            )


def downgrade() -> None:
    raise RuntimeError(
        "0053_practice_source_takes is destructive; restore pre-release schema from Git history."
    )
