"""Application schema and finite storage plan reference data."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE importartifactkind AS ENUM ('review_musicxml')")
    op.execute(
        "CREATE TYPE importdispatchstatus AS ENUM ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED')"
    )
    op.execute(
        "CREATE TYPE importjobstate AS ENUM ('QUEUED', 'PROCESSING', 'READY_FOR_REVIEW', 'CONFIRMED', 'FAILED')"
    )
    op.execute(
        "CREATE TYPE importjobstepstatus AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')"
    )
    op.execute(
        "CREATE TYPE inviteterminaloutcome AS ENUM ('ACCEPTED', 'DECLINED', 'REVOKED', 'RECIPIENT_ACCOUNT_CLOSED', 'INVITER_ACCOUNT_CLOSED')"
    )
    op.execute(
        "CREATE TYPE mailoutboxstatus AS ENUM ('PENDING', 'DISPATCHED', 'PROCESSING', 'SENT', 'FAILED', 'PERMANENT_FAILURE', 'EXPIRED', 'CANCELLED')"
    )
    op.execute("CREATE TYPE membershiprole AS ENUM ('VIEWER', 'PRACTITIONER', 'EDITOR')")
    op.execute("CREATE TYPE metadatastatus AS ENUM ('PENDING', 'READY', 'FAILED')")
    op.execute(
        "CREATE TYPE operatorrole AS ENUM ('SUPPORT_READONLY', 'PLATFORM_OPERATOR', 'SUPER_ADMIN')"
    )
    op.execute(
        "CREATE TYPE operatorchallengepurpose AS ENUM ('ENROLLMENT_REQUIRED', 'VERIFICATION_REQUIRED')"
    )
    op.execute("CREATE TYPE operatorstatus AS ENUM ('active', 'disabled')")
    op.execute("CREATE TYPE playbackassetkind AS ENUM ('AUDIO')")
    op.execute(
        "CREATE TYPE playbackoutboxstatus AS ENUM ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED', 'SUPERSEDED')"
    )
    op.execute("CREATE TYPE renderassetkind AS ENUM ('RENDERED_PAGE')")
    op.execute("CREATE TYPE revisionorigin AS ENUM ('OMR', 'EDIT', 'IMPORT')")
    op.execute("CREATE TYPE revisionsourceformat AS ENUM ('MUSICXML')")
    op.execute(
        "CREATE TYPE scoredeletionoperationstatus AS ENUM ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED')"
    )
    op.execute(
        "CREATE TYPE storageusagecategory AS ENUM ('SOURCE', 'UPLOAD', 'INPUT_ASSET', 'DERIVED_RENDER', 'DERIVED_AUDIO', 'TEMP_IMPORT')"
    )
    op.create_table(
        "execution_manifests",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "manifest",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sha256", name="uq_execution_manifests_sha256"),
    )
    op.create_table(
        "mail_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("source_kind", sa.String(length=32), nullable=True),
        sa.Column("source_id", sa.BigInteger(), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("dedupe_key", sa.String(length=160), nullable=False),
        sa.Column("originating_request_id", sa.String(length=64), nullable=True),
        sa.Column("traceparent", sa.String(length=55), nullable=True),
        sa.Column("tracestate", sa.String(length=512), nullable=True),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("text_body", sa.Text(), nullable=True),
        sa.Column("html_body", sa.Text(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "SENT",
                "FAILED",
                "PERMANENT_FAILURE",
                "EXPIRED",
                "CANCELLED",
                name="mailoutboxstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_message_id", sa.String(length=128), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_mail_outbox_failure_facts",
        ),
        sa.CheckConstraint(
            "(source_kind IS NULL AND source_id IS NULL AND CAST(status AS TEXT) IN ('SENT','PERMANENT_FAILURE','EXPIRED','CANCELLED')) OR (source_kind IS NOT NULL AND source_id IS NOT NULL AND source_kind IN ('ACCOUNT','AUTH_TOKEN','EMAIL_CHANGE','REGISTRATION','SCORE_INVITE') AND source_id > 0)",
            name="ck_mail_outbox_source",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_mail_outbox_attempt_token",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_mail_outbox_attempt_count"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
        sa.UniqueConstraint("outbox_uuid"),
    )
    op.create_index("idx_mail_outbox_created", "mail_outbox", ["created_at"], unique=False)
    op.create_index(
        "idx_mail_outbox_dispatched", "mail_outbox", ["status", "dispatched_at"], unique=False
    )
    op.create_index(
        "idx_mail_outbox_source", "mail_outbox", ["source_kind", "source_id"], unique=False
    )
    op.create_index(
        "idx_mail_outbox_status_available",
        "mail_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_mail_outbox_originating_request_id"),
        "mail_outbox",
        ["originating_request_id"],
        unique=False,
    )
    op.create_table(
        "object_write_intents",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("intent_uuid", sa.String(length=36), nullable=False),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PREPARED",
                "WRITING",
                "WRITE_UNKNOWN",
                "WRITTEN",
                "ADOPTED",
                "CLEANUP_PENDING",
                "CLEANUP_DISPATCHED",
                "CLEANUP_PROCESSING",
                "CLEANUP_FAILED",
                "CLEANED",
                name="ck_object_write_intent_status",
                native_enum=False,
                create_constraint=False,
                length=24,
            ),
            nullable=False,
        ),
        sa.Column("write_token", sa.String(length=36), nullable=False),
        sa.Column("write_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("written_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(status = 'CLEANUP_PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'CLEANUP_PROCESSING' AND attempt_token IS NULL)",
            name="ck_object_write_intents_attempt_token",
        ),
        sa.CheckConstraint(
            "status IN ('PREPARED', 'WRITING', 'WRITE_UNKNOWN', 'WRITTEN', 'ADOPTED', 'CLEANUP_PENDING', 'CLEANUP_DISPATCHED', 'CLEANUP_PROCESSING', 'CLEANUP_FAILED', 'CLEANED')",
            name="ck_object_write_intent_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_object_write_intent_attempts"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("intent_uuid"),
        sa.UniqueConstraint("object_key", name="uq_object_write_intent_key"),
    )
    op.create_index(
        "ix_object_write_intent_due",
        "object_write_intents",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_table(
        "operators",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("operator_uuid", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM(
                "SUPPORT_READONLY",
                "PLATFORM_OPERATOR",
                "SUPER_ADMIN",
                name="operatorrole",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM("active", "disabled", name="operatorstatus", create_type=False),
            nullable=False,
        ),
        sa.Column("totp_secret_encrypted", sa.String(length=512), nullable=True),
        sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("totp_last_used_step", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(totp_enabled_at IS NULL AND totp_secret_encrypted IS NULL AND totp_last_used_step IS NULL) OR (totp_enabled_at IS NOT NULL AND totp_secret_encrypted IS NOT NULL AND totp_last_used_step IS NOT NULL)",
            name="ck_operators_totp_facts",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("operator_uuid"),
    )
    op.create_index("idx_operators_status_role", "operators", ["status", "role"], unique=False)
    op.create_table(
        "pending_registrations",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("resend_count", sa.Integer(), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_pending_registrations_consumed", "pending_registrations", ["consumed_at"], unique=False
    )
    op.create_index(
        "idx_pending_registrations_email", "pending_registrations", ["email"], unique=True
    )
    op.create_index(
        "idx_pending_registrations_expires", "pending_registrations", ["expires_at"], unique=False
    )
    op.create_index(
        "idx_pending_registrations_token_hash", "pending_registrations", ["token_hash"], unique=True
    )
    op.create_table(
        "scheduler_heartbeats",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("job_key", sa.String(length=80), nullable=False),
        sa.Column("last_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_duration_ms", sa.Integer(), nullable=False),
        sa.Column("last_due_count", sa.Integer(), nullable=False),
        sa.Column("last_dispatched_count", sa.Integer(), nullable=False),
        sa.Column("total_duration_ms", sa.Integer(), nullable=False),
        sa.Column("total_due_count", sa.Integer(), nullable=False),
        sa.Column("total_dispatched_count", sa.Integer(), nullable=False),
        sa.Column("lock_acquired_count", sa.Integer(), nullable=False),
        sa.Column("lock_skipped_count", sa.Integer(), nullable=False),
        sa.Column("last_lock_skipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("success_count", sa.Integer(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_scheduler_heartbeats_job_key", "scheduler_heartbeats", ["job_key"], unique=True
    )
    op.create_index(
        "idx_scheduler_heartbeats_last_success",
        "scheduler_heartbeats",
        ["last_success_at"],
        unique=False,
    )
    op.create_table(
        "scheduler_leader_statuses",
        sa.Column("scheduler_name", sa.String(length=80), nullable=False),
        sa.Column("last_acquired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_standby_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_child_exit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acquired_count", sa.Integer(), nullable=False),
        sa.Column("standby_count", sa.Integer(), nullable=False),
        sa.Column("child_exit_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("scheduler_name"),
    )
    op.create_table(
        "storage_plan_policies",
        sa.Column(
            "plan_code",
            sa.Enum(
                "FREE",
                "PLUS",
                "PRO",
                name="ck_storage_plan_policy_code",
                native_enum=False,
                create_constraint=False,
                length=64,
            ),
            nullable=False,
        ),
        sa.Column("default_limit_bytes", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "plan_code IN ('FREE', 'PLUS', 'PRO')", name="ck_storage_plan_policy_code"
        ),
        sa.CheckConstraint(
            "default_limit_bytes >= 0", name="ck_storage_plan_policies_limit_nonnegative"
        ),
        sa.PrimaryKeyConstraint("plan_code"),
    )
    op.create_table(
        "stored_objects",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("provider_etag", sa.String(length=255), nullable=True),
        sa.Column("transport_checksum_algorithm", sa.String(length=32), nullable=True),
        sa.Column("transport_checksum", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "sha256 IS NULL OR length(sha256) = 64 AND replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(sha256, '0', ''), '1', ''), '2', ''), '3', ''), '4', ''), '5', ''), '6', ''), '7', ''), '8', ''), '9', ''), 'a', ''), 'b', ''), 'c', ''), 'd', ''), 'e', ''), 'f', '') = ''",
            name="ck_stored_object_digest",
        ),
        sa.CheckConstraint(
            "(transport_checksum_algorithm IS NULL) = (transport_checksum IS NULL)",
            name="ck_stored_object_transport_checksum",
        ),
        sa.CheckConstraint("byte_size >= 0", name="ck_stored_object_nonnegative_size"),
        sa.CheckConstraint(
            "length(trim(object_key)) > 0 AND length(trim(content_type)) > 0",
            name="ck_stored_object_locator_type",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key", name="uq_stored_object_locator"),
    )
    op.create_index("ix_stored_objects_sha256", "stored_objects", ["sha256"], unique=False)
    op.create_table(
        "ops_audit_events",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("event_uuid", sa.String(length=36), nullable=False),
        sa.Column("actor_operator_id", sa.BigInteger(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=40), nullable=False),
        sa.Column("target_id", sa.String(length=128), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("previous_state", sa.String(length=128), nullable=True),
        sa.Column("new_state", sa.String(length=128), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(btrim(reason)) BETWEEN 3 AND 500 AND reason=btrim(reason)",
            name="ck_ops_audit_reason",
        ),
        sa.ForeignKeyConstraint(["actor_operator_id"], ["operators.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_uuid"),
    )
    op.create_index(
        "idx_ops_audit_events_action_created",
        "ops_audit_events",
        ["action", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_ops_audit_events_actor_created",
        "ops_audit_events",
        ["actor_operator_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_ops_audit_events_operation",
        "ops_audit_events",
        ["target_type", "target_id"],
        unique=False,
    )
    op.create_table(
        "practice_bundles",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("bundle_id", sa.String(length=128), nullable=False),
        sa.Column("artifact_id", sa.String(length=128), nullable=False),
        sa.Column("artifact_schema_version", sa.Integer(), nullable=False),
        sa.Column(
            "prepared_musicxml_object_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=True,
        ),
        sa.Column(
            "artifact_object_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "CREATING",
                "READY",
                name="ck_practice_bundles_status",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("creation_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(status = 'CREATING' AND creation_expires_at IS NOT NULL AND prepared_musicxml_object_id IS NULL AND artifact_object_id IS NULL) OR (status = 'READY' AND creation_expires_at IS NULL AND prepared_musicxml_object_id IS NOT NULL AND artifact_object_id IS NOT NULL)",
            name="ck_practice_bundles_creation_lease",
        ),
        sa.CheckConstraint("status IN ('CREATING', 'READY')", name="ck_practice_bundles_status"),
        sa.ForeignKeyConstraint(["artifact_object_id"], ["stored_objects.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["prepared_musicxml_object_id"], ["stored_objects.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_object_id", name="uq_practice_bundles_artifact_object"),
        sa.UniqueConstraint("bundle_id", name="uq_practice_bundles_bundle_id"),
        sa.UniqueConstraint(
            "prepared_musicxml_object_id", name="uq_practice_bundles_musicxml_object"
        ),
    )
    op.create_index(
        "ix_practice_bundles_status_creation",
        "practice_bundles",
        ["status", "creation_expires_at"],
        unique=False,
    )
    op.create_table(
        "stored_object_retirements",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("retirement_uuid", sa.String(length=36), nullable=False),
        sa.Column("stored_object_id", sa.BigInteger(), nullable=True),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("provider_etag", sa.String(length=255), nullable=True),
        sa.Column("transport_checksum_algorithm", sa.String(length=32), nullable=True),
        sa.Column("transport_checksum", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "FAILED",
                "COMPLETED",
                "CANCELLED",
                name="ck_object_retirement_status",
                native_enum=False,
                create_constraint=False,
                length=24,
            ),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deletion_fenced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_object_retirement_failure_facts",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_stored_object_retirements_attempt_token",
        ),
        sa.CheckConstraint(
            "deletion_fenced_at IS NULL OR status <> 'CANCELLED'",
            name="ck_object_retirement_deletion_fence",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'FAILED', 'COMPLETED', 'CANCELLED')",
            name="ck_object_retirement_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_object_retirement_attempts"),
        sa.ForeignKeyConstraint(["stored_object_id"], ["stored_objects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("retirement_uuid"),
        sa.UniqueConstraint("stored_object_id", name="uq_object_retirement_object"),
    )
    op.create_index(
        "ix_object_retirement_due",
        "stored_object_retirements",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("avatar_object_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["avatar_object_id"], ["stored_objects.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("display_name"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_users_avatar_object_id"), "users", ["avatar_object_id"], unique=False)
    op.create_table(
        "account_deletion_operations",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("operation_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("user_id_snapshot", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "FAILED",
                "COMPLETED",
                name="ck_account_deletion_status",
                native_enum=False,
                create_constraint=False,
                length=24,
            ),
            nullable=False,
        ),
        sa.Column(
            "phase",
            sa.Enum(
                "SCORES",
                "IMPORTS",
                "TAKES",
                "UPLOADS",
                "TRANSFERS",
                "FINALIZE",
                name="ck_account_deletion_phase",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_account_deletion_failure_facts",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_account_deletion_attempt_token",
        ),
        sa.CheckConstraint(
            "phase IN ('SCORES', 'IMPORTS', 'TAKES', 'UPLOADS', 'TRANSFERS', 'FINALIZE')",
            name="ck_account_deletion_phase",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'FAILED', 'COMPLETED')",
            name="ck_account_deletion_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_account_deletion_attempts"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_uuid"),
        sa.UniqueConstraint("user_id"),
        sa.UniqueConstraint("user_id_snapshot"),
    )
    op.create_index(
        "ix_account_deletion_due",
        "account_deletion_operations",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("idx_auth_tokens_expires", "auth_tokens", ["expires_at"], unique=False)
    op.create_index("idx_auth_tokens_used", "auth_tokens", ["used_at"], unique=False)
    op.create_index(
        "idx_auth_tokens_user_purpose", "auth_tokens", ["user_id", "purpose"], unique=False
    )
    op.create_table(
        "email_change_requests",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("new_email", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("locale", sa.String(length=8), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_email_change_requests_consumed", "email_change_requests", ["consumed_at"], unique=False
    )
    op.create_index(
        "idx_email_change_requests_expires", "email_change_requests", ["expires_at"], unique=False
    )
    op.create_index(
        "idx_email_change_requests_new_email", "email_change_requests", ["new_email"], unique=False
    )
    op.create_index(
        "idx_email_change_requests_token_hash", "email_change_requests", ["token_hash"], unique=True
    )
    op.create_index(
        "idx_email_change_requests_user_created",
        "email_change_requests",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "import_jobs",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("job_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "state",
            postgresql.ENUM(
                "QUEUED",
                "PROCESSING",
                "READY_FOR_REVIEW",
                "CONFIRMED",
                "FAILED",
                name="importjobstate",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("current_step", sa.String(length=64), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("submission_fingerprint", sa.String(length=64), nullable=True),
        sa.Column(
            "requested_options",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("execution_manifest_id", sa.BigInteger(), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_import_jobs_failure_facts",
        ),
        sa.CheckConstraint(
            "(state = 'FAILED' AND failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL) OR (state <> 'FAILED' AND failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL)",
            name="ck_import_jobs_state_failure",
        ),
        sa.CheckConstraint(
            "(state = 'QUEUED' AND processing_started_at IS NULL AND processing_finished_at IS NULL AND confirmed_at IS NULL) OR (state = 'PROCESSING' AND processing_started_at IS NOT NULL AND processing_finished_at IS NULL AND confirmed_at IS NULL) OR (state = 'READY_FOR_REVIEW' AND processing_started_at IS NOT NULL AND processing_finished_at IS NOT NULL AND confirmed_at IS NULL) OR (state = 'CONFIRMED' AND processing_started_at IS NOT NULL AND processing_finished_at IS NOT NULL AND confirmed_at IS NOT NULL) OR (state = 'FAILED' AND processing_finished_at IS NOT NULL AND confirmed_at IS NULL)",
            name="ck_import_jobs_lifecycle",
        ),
        sa.CheckConstraint(
            "(idempotency_key IS NULL AND submission_fingerprint IS NULL) OR (idempotency_key IS NOT NULL AND submission_fingerprint IS NOT NULL)",
            name="ck_import_submission_identity",
        ),
        sa.CheckConstraint("progress >= 0 AND progress <= 100", name="ck_import_jobs_progress"),
        sa.ForeignKeyConstraint(
            ["execution_manifest_id"],
            ["execution_manifests.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_uuid"),
        sa.UniqueConstraint(
            "user_id", "idempotency_key", name="uq_import_jobs_user_idempotency_key"
        ),
    )
    op.create_index("idx_import_jobs_state", "import_jobs", ["state"], unique=False)
    op.create_index(
        "idx_import_jobs_user_created", "import_jobs", ["user_id", "created_at"], unique=False
    )
    op.create_index(
        op.f("ix_import_jobs_execution_manifest_id"),
        "import_jobs",
        ["execution_manifest_id"],
        unique=False,
    )
    op.create_table(
        "notifications",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("notification_uuid", sa.String(length=36), nullable=False),
        sa.Column("recipient_user_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "kind",
            sa.Enum(
                "score_invite.accepted",
                "score_invite.declined",
                "score.version.created",
                "import.ready_for_review",
                "import.failed",
                name="notificationkind",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column("dedupe_key", sa.String(length=160), nullable=True),
        sa.Column("invite_id", sa.String(length=36), nullable=True),
        sa.Column("score_id", sa.String(length=36), nullable=True),
        sa.Column("revision_id", sa.String(length=36), nullable=True),
        sa.Column("import_job_id", sa.String(length=36), nullable=True),
        sa.Column("score_display_title_snapshot", sa.String(length=255), nullable=True),
        sa.Column("import_display_title_snapshot", sa.String(length=255), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "\n          (kind IN ('score_invite.accepted', 'score_invite.declined') AND invite_id IS NOT NULL\n           AND score_id IS NOT NULL AND actor_user_id IS NOT NULL AND score_display_title_snapshot IS NOT NULL\n           AND revision_id IS NULL AND import_job_id IS NULL AND import_display_title_snapshot IS NULL)\n          OR (kind = 'score.version.created' AND score_id IS NOT NULL AND revision_id IS NOT NULL\n           AND actor_user_id IS NOT NULL AND score_display_title_snapshot IS NOT NULL AND invite_id IS NULL\n           AND import_job_id IS NULL AND import_display_title_snapshot IS NULL)\n          OR (kind = 'import.ready_for_review' AND import_job_id IS NOT NULL AND actor_user_id IS NULL\n           AND invite_id IS NULL AND revision_id IS NULL\n           AND ((score_id IS NULL AND score_display_title_snapshot IS NULL)\n             OR (score_id IS NOT NULL AND score_display_title_snapshot IS NOT NULL)))\n          OR (kind = 'import.failed' AND import_job_id IS NOT NULL AND actor_user_id IS NULL\n           AND invite_id IS NULL AND revision_id IS NULL AND score_id IS NULL AND score_display_title_snapshot IS NULL)\n        ",
            name="ck_notifications_semantic_identity",
        ),
        sa.CheckConstraint(
            "kind IN ('score_invite.accepted', 'score_invite.declined', 'score.version.created', 'import.ready_for_review', 'import.failed')",
            name="notificationkind",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
        sa.UniqueConstraint("notification_uuid"),
    )
    op.create_index(
        "idx_notifications_recipient_created",
        "notifications",
        ["recipient_user_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "idx_notifications_recipient_read",
        "notifications",
        ["recipient_user_id", "read_at"],
        unique=False,
    )
    op.create_table(
        "operator_sessions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("session_uuid", sa.String(length=36), nullable=False),
        sa.Column("operator_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "created_at <= last_seen_at AND last_seen_at < absolute_expires_at AND idle_expires_at <= absolute_expires_at",
            name="ck_operator_sessions_lifetime",
        ),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_uuid"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "idx_operator_sessions_expiry",
        "operator_sessions",
        ["idle_expires_at", "absolute_expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_operator_sessions_operator_created",
        "operator_sessions",
        ["operator_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "operator_mfa_challenges",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("challenge_uuid", sa.String(length=36), nullable=False),
        sa.Column("operator_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "purpose",
            postgresql.ENUM(
                "ENROLLMENT_REQUIRED",
                "VERIFICATION_REQUIRED",
                name="operatorchallengepurpose",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("pending_secret_encrypted", sa.String(length=512), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "attempt_count >= 0 AND attempt_count <= 5", name="ck_operator_mfa_attempts"
        ),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge_uuid"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "idx_operator_mfa_challenges_operator_expiry",
        "operator_mfa_challenges",
        ["operator_id", "expires_at"],
        unique=False,
    )

    op.create_table(
        "operator_recovery_codes",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("operator_id", sa.BigInteger(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index(
        "idx_operator_recovery_codes_owner",
        "operator_recovery_codes",
        ["operator_id"],
        unique=False,
    )
    op.create_table(
        "performance_take_manifests",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("take_uuid", sa.String(length=36), nullable=False),
        sa.Column("manifest_json", sa.Text(), nullable=False),
        sa.Column("manifest_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(manifest_sha256) = 64", name="ck_take_manifest_digest_length"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id", name="uq_take_manifest_id_owner"),
    )
    op.create_index(
        op.f("ix_performance_take_manifests_take_uuid"),
        "performance_take_manifests",
        ["take_uuid"],
        unique=True,
    )
    op.create_index(
        op.f("ix_performance_take_manifests_user_id"),
        "performance_take_manifests",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_take_manifest_user_created",
        "performance_take_manifests",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "realtime_changes",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("change_uuid", sa.String(length=36), nullable=False),
        sa.Column("recipient_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "notifications.changed",
                "score.revisions.changed",
                "score.derived_assets.changed",
                "score.metadata.changed",
                "import_jobs.changed",
                name="realtimechangekind",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column("notification_id", sa.String(length=36), nullable=True),
        sa.Column("score_id", sa.String(length=36), nullable=True),
        sa.Column("revision_id", sa.String(length=36), nullable=True),
        sa.Column("import_job_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "\n          (kind = 'notifications.changed' AND score_id IS NULL AND revision_id IS NULL AND import_job_id IS NULL)\n          OR (kind IN ('score.revisions.changed', 'score.derived_assets.changed', 'score.metadata.changed')\n              AND score_id IS NOT NULL AND revision_id IS NOT NULL AND notification_id IS NULL AND import_job_id IS NULL)\n          OR (kind = 'import_jobs.changed' AND import_job_id IS NOT NULL\n              AND notification_id IS NULL AND score_id IS NULL AND revision_id IS NULL)\n        ",
            name="ck_realtime_changes_identity",
        ),
        sa.CheckConstraint(
            "kind IN ('notifications.changed', 'score.revisions.changed', 'score.derived_assets.changed', 'score.metadata.changed', 'import_jobs.changed')",
            name="realtimechangekind",
        ),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("change_uuid"),
        sa.UniqueConstraint(
            "recipient_user_id", "sequence", name="uq_realtime_changes_recipient_sequence"
        ),
    )
    op.create_index(
        "idx_realtime_changes_created", "realtime_changes", ["created_at"], unique=False
    )
    op.create_table(
        "realtime_stream_state",
        sa.Column("recipient_user_id", sa.BigInteger(), nullable=False),
        sa.Column("high_watermark_sequence", sa.BigInteger(), nullable=False),
        sa.Column("replay_floor_sequence", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "high_watermark_sequence >= 0", name="ck_realtime_stream_high_watermark"
        ),
        sa.CheckConstraint(
            "replay_floor_sequence <= high_watermark_sequence",
            name="ck_realtime_stream_replay_range",
        ),
        sa.CheckConstraint("replay_floor_sequence >= 0", name="ck_realtime_stream_floor"),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("recipient_user_id"),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "revoked_reason",
            sa.Enum(
                "LOGOUT",
                "DEVICE_REVOKED",
                "OTHER_SESSIONS",
                "PASSWORD_CHANGED",
                "PASSWORD_RESET",
                "ACCOUNT_CLOSED",
                name="sessionrevocationreason",
            ),
            nullable=True,
        ),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.CheckConstraint(
            "length(token_hash)=64 AND token_hash ~ '^[0-9a-f]+$'", name="ck_user_sessions_digest"
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL AND revoked_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)",
            name="ck_user_sessions_revocation",
        ),
        sa.CheckConstraint(
            "created_at <= last_seen_at AND last_seen_at < absolute_expires_at AND idle_expires_at <= absolute_expires_at",
            name="ck_user_sessions_lifetime",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_user_sessions_expiration",
        "user_sessions",
        ["idle_expires_at", "absolute_expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_user_sessions_user_created", "user_sessions", ["user_id", "created_at"], unique=False
    )
    op.create_index(
        op.f("ix_user_sessions_token_hash"), "user_sessions", ["token_hash"], unique=True
    )
    op.create_index(op.f("ix_user_sessions_user_id"), "user_sessions", ["user_id"], unique=False)
    op.create_table(
        "score_library_folders",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("folder_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("position >= 0", name="ck_score_library_folders_position"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("folder_uuid"),
        sa.UniqueConstraint("user_id", "name", name="uq_score_library_folders_user_name"),
    )
    op.create_table(
        "storage_quota_holds",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("hold_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("command_key", sa.String(length=160), nullable=False),
        sa.Column(
            "category",
            postgresql.ENUM(
                "SOURCE",
                "UPLOAD",
                "INPUT_ASSET",
                "DERIVED_RENDER",
                "DERIVED_AUDIO",
                "TEMP_IMPORT",
                name="storageusagecategory",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("bytes_held", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "HELD",
                "CONSUMED",
                "RELEASED",
                "EXPIRED",
                name="storagequotaholdstatus",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(status = 'HELD' AND consumed_at IS NULL AND released_at IS NULL AND expired_at IS NULL) OR (status = 'CONSUMED' AND consumed_at IS NOT NULL AND consumed_at < expires_at AND released_at IS NULL AND expired_at IS NULL) OR (status = 'RELEASED' AND released_at IS NOT NULL AND consumed_at IS NULL AND expired_at IS NULL) OR (status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at AND consumed_at IS NULL AND released_at IS NULL)",
            name="ck_storage_quota_holds_lifecycle",
        ),
        sa.CheckConstraint(
            "category IN ('SOURCE', 'UPLOAD', 'INPUT_ASSET')",
            name="ck_storage_quota_holds_category",
        ),
        sa.CheckConstraint("bytes_held > 0", name="ck_storage_quota_holds_positive_bytes"),
        sa.CheckConstraint("expires_at > created_at", name="ck_storage_quota_holds_expiry"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hold_uuid"),
        sa.UniqueConstraint("user_id", "command_key", name="uq_storage_quota_holds_user_command"),
    )
    op.create_index(
        "idx_storage_quota_holds_status_expiry",
        "storage_quota_holds",
        ["status", "expires_at", "id"],
        unique=False,
    )
    op.create_index(
        "idx_storage_quota_holds_user_status_expiry",
        "storage_quota_holds",
        ["user_id", "status", "expires_at"],
        unique=False,
    )
    op.create_table(
        "storage_usage_accounts",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("used_bytes >= 0", name="ck_storage_usage_accounts_used_non_negative"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "storage_usage_counters",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "category",
            postgresql.ENUM(
                "SOURCE",
                "UPLOAD",
                "INPUT_ASSET",
                "DERIVED_RENDER",
                "DERIVED_AUDIO",
                "TEMP_IMPORT",
                name="storageusagecategory",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("used_bytes >= 0", name="ck_storage_usage_counters_used_non_negative"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "category", name="uq_storage_usage_counters_user_category"),
    )
    op.create_index(
        "idx_storage_usage_counters_user", "storage_usage_counters", ["user_id"], unique=False
    )
    op.create_table(
        "storage_usage_events",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "category",
            postgresql.ENUM(
                "SOURCE",
                "UPLOAD",
                "INPUT_ASSET",
                "DERIVED_RENDER",
                "DERIVED_AUDIO",
                "TEMP_IMPORT",
                name="storageusagecategory",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("delta_bytes", sa.BigInteger(), nullable=False),
        sa.Column("counts_toward_quota_snapshot", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=True),
        sa.Column("object_id", sa.String(length=128), nullable=True),
        sa.Column("storage_key", sa.String(length=768), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_storage_usage_events_object",
        "storage_usage_events",
        ["object_type", "object_id"],
        unique=False,
    )
    op.create_index(
        "idx_storage_usage_events_user_created",
        "storage_usage_events",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "upload_sessions",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("session_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum(
                "SCORE_IMPORT",
                "PERFORMANCE_TAKE",
                name="ck_upload_session_purpose",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "mode",
            sa.Enum(
                "SINGLE_PUT",
                "MULTIPART",
                name="ck_upload_session_mode",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "CREATING",
                "UPLOADING",
                "COMPLETING",
                "COMPLETED",
                "CONSUMED",
                "CANCELLED",
                "EXPIRED",
                "FAILED",
                name="ck_upload_session_status",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.String(length=768), nullable=False),
        sa.Column("final_object_key", sa.String(length=768), nullable=False),
        sa.Column("expected_byte_size", sa.BigInteger(), nullable=False),
        sa.Column("expected_content_type", sa.String(length=255), nullable=False),
        sa.Column("part_bytes", sa.Integer(), nullable=False),
        sa.Column("provider_upload_id", sa.String(length=1024), nullable=True),
        sa.Column("provider_etag", sa.String(length=255), nullable=True),
        sa.Column("transport_checksum_algorithm", sa.String(length=32), nullable=True),
        sa.Column("transport_checksum", sa.String(length=255), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("write_intent_uuid", sa.String(length=36), nullable=True),
        sa.Column("operation_token", sa.String(length=36), nullable=True),
        sa.Column("operation_kind", sa.String(length=16), nullable=True),
        sa.Column("operation_unknown", sa.Boolean(), nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("capability_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cleanup_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "mode <> 'SINGLE_PUT' OR provider_upload_id IS NULL",
            name="ck_upload_session_handle_mode",
        ),
        sa.CheckConstraint("mode IN ('SINGLE_PUT', 'MULTIPART')", name="ck_upload_session_mode"),
        sa.CheckConstraint(
            "purpose IN ('SCORE_IMPORT', 'PERFORMANCE_TAKE')", name="ck_upload_session_purpose"
        ),
        sa.CheckConstraint(
            "status <> 'CONSUMED' OR consumed_at IS NOT NULL", name="ck_upload_session_consumed"
        ),
        sa.CheckConstraint(
            "status IN ('CREATING', 'UPLOADING', 'COMPLETING', 'COMPLETED', 'CONSUMED', 'CANCELLED', 'EXPIRED', 'FAILED')",
            name="ck_upload_session_status",
        ),
        sa.CheckConstraint(
            "(transport_checksum_algorithm IS NULL) = (transport_checksum IS NULL)",
            name="ck_upload_session_checksum",
        ),
        sa.CheckConstraint(
            "expected_byte_size > 0 AND generation > 0 AND part_bytes > 0",
            name="ck_upload_session_plan",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["write_intent_uuid"], ["object_write_intents.intent_uuid"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("final_object_key", name="uq_upload_session_final_key"),
        sa.UniqueConstraint("object_key", name="uq_upload_session_key"),
        sa.UniqueConstraint("session_uuid", name="uq_upload_session_uuid"),
    )
    op.create_index(
        "ix_upload_session_cleanup",
        "upload_sessions",
        ["status", "cleanup_completed_at"],
        unique=False,
    )
    op.create_index(
        "ix_upload_session_expiry", "upload_sessions", ["status", "expires_at"], unique=False
    )
    op.create_index(
        "ix_upload_session_user_status", "upload_sessions", ["user_id", "status"], unique=False
    )
    op.create_table(
        "user_storage_entitlements",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "plan_code",
            sa.Enum("FREE", "PLUS", "PRO", name="storageplancode", native_enum=False, length=64),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["plan_code"],
            ["storage_plan_policies.plan_code"],
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "import_artifacts",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("artifact_uuid", sa.String(length=36), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "kind",
            postgresql.ENUM("review_musicxml", name="importartifactkind", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "stored_object_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["import_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stored_object_id"], ["stored_objects.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_uuid"),
        sa.UniqueConstraint("stored_object_id", name="uq_import_artifacts_stored_object"),
    )
    op.create_index(
        "idx_import_artifacts_job_kind", "import_artifacts", ["job_id", "kind"], unique=False
    )
    op.create_table(
        "import_dispatches",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("dispatch_uuid", sa.String(length=36), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("originating_request_id", sa.String(length=64), nullable=True),
        sa.Column("traceparent", sa.String(length=55), nullable=True),
        sa.Column("tracestate", sa.String(length=512), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "COMPLETED",
                "FAILED",
                name="importdispatchstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_import_dispatches_failure_facts",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_import_dispatch_attempt_token",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_import_dispatch_attempt_count"),
        sa.ForeignKeyConstraint(["job_id"], ["import_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dispatch_uuid"),
        sa.UniqueConstraint("job_id"),
    )
    op.create_index(
        "idx_import_dispatch_due", "import_dispatches", ["status", "next_attempt_at"], unique=False
    )
    op.create_index(
        op.f("ix_import_dispatches_originating_request_id"),
        "import_dispatches",
        ["originating_request_id"],
        unique=False,
    )
    op.create_table(
        "import_job_steps",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "PENDING",
                "RUNNING",
                "COMPLETED",
                "FAILED",
                name="importjobstepstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["import_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "name", name="uq_import_job_steps_job_name"),
    )
    op.create_index(
        "idx_import_job_steps_job_order", "import_job_steps", ["job_id", "step_order"], unique=False
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
        sa.Column("upload_session_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column(
            "manifest_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column("client_request_id", sa.String(length=128), nullable=False),
        sa.Column("quota_hold_id", sa.BigInteger(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finalizing_token", sa.String(length=36), nullable=True),
        sa.Column("finalizing_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "RESERVED",
                "FINALIZING",
                "COMPLETED",
                "CANCELLED",
                "EXPIRED",
                name="ck_take_reservation_status",
                native_enum=False,
                create_constraint=False,
                length=24,
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(status = 'FINALIZING' AND finalizing_token IS NOT NULL AND finalizing_expires_at IS NOT NULL) OR (status != 'FINALIZING' AND finalizing_token IS NULL AND finalizing_expires_at IS NULL)",
            name="ck_take_reservation_finalize_lease",
        ),
        sa.CheckConstraint(
            "status IN ('RESERVED', 'FINALIZING', 'COMPLETED', 'CANCELLED', 'EXPIRED')",
            name="ck_take_reservation_status",
        ),
        sa.ForeignKeyConstraint(
            ["manifest_id", "user_id"],
            ["performance_take_manifests.id", "performance_take_manifests.user_id"],
            name="fk_take_reservation_manifest_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["quota_hold_id"],
            ["storage_quota_holds.id"],
            name="fk_take_upload_quota_hold",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["upload_session_id"], ["upload_sessions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("quota_hold_id", name="uq_take_upload_quota_hold"),
        sa.UniqueConstraint("upload_session_id"),
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
        op.f("ix_performance_take_upload_reservations_manifest_id"),
        "performance_take_upload_reservations",
        ["manifest_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_take_upload_reservations_reservation_uuid"),
        "performance_take_upload_reservations",
        ["reservation_uuid"],
        unique=True,
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
        "scores",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("score_uuid", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=False),
        sa.Column("display_title", sa.String(length=255), nullable=False),
        sa.Column(
            "genres",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("head_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("created_from_import_job_id", sa.BigInteger(), nullable=True),
        sa.Column("metadata_version", sa.Integer(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("metadata_version >= 1", name="ck_scores_metadata_version_positive"),
        sa.ForeignKeyConstraint(
            ["created_from_import_job_id"], ["import_jobs.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("created_from_import_job_id"),
        sa.UniqueConstraint("score_uuid"),
    )
    op.create_index(
        "idx_scores_owner_active_updated",
        "scores",
        ["owner_user_id", "deleted_at", "updated_at"],
        unique=False,
    )
    op.create_index(
        "idx_scores_owner_updated", "scores", ["owner_user_id", "updated_at"], unique=False
    )
    op.create_table(
        "uploads",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("upload_uuid", sa.String(length=36), nullable=False),
        sa.Column("upload_session_id", sa.BigInteger(), nullable=False),
        sa.Column("stored_object_id", sa.BigInteger(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("uploader_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["stored_object_id"], ["stored_objects.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["upload_session_id"], ["upload_sessions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["uploader_user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("upload_session_id"),
        sa.UniqueConstraint("upload_uuid", name="uq_uploads_upload_uuid"),
    )
    op.create_index("idx_uploads_stored_object", "uploads", ["stored_object_id"], unique=False)
    op.create_index(
        "idx_uploads_user_created", "uploads", ["uploader_user_id", "created_at"], unique=False
    )
    op.create_table(
        "guest_preview_credentials",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "length(token_hash) = 64", name="ck_guest_preview_credentials_hash_length"
        ),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("score_id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_table(
        "import_job_uploads",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("upload_id", sa.BigInteger(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["import_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["upload_id"],
            ["uploads.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "upload_id", name="uq_import_job_uploads_job_upload"),
    )
    op.create_index("idx_import_job_uploads_job", "import_job_uploads", ["job_id"], unique=False)
    op.create_table(
        "performance_takes",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column(
            "media_status",
            sa.Enum(
                "UPLOADED",
                "PROCESSING",
                "READY",
                "FAILED",
                name="ck_take_media_status",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "manifest_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column(
            "owner_user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column(
            "linked_score_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True
        ),
        sa.Column(
            "recording_object_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "media_status IN ('UPLOADED', 'PROCESSING', 'READY', 'FAILED')",
            name="ck_take_media_status",
        ),
        sa.ForeignKeyConstraint(["linked_score_id"], ["scores.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["manifest_id", "owner_user_id"],
            ["performance_take_manifests.id", "performance_take_manifests.user_id"],
            name="fk_performance_takes_manifest_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["recording_object_id"], ["stored_objects.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("manifest_id", name="uq_performance_takes_manifest"),
        sa.UniqueConstraint("recording_object_id", name="uq_performance_takes_recording_object"),
    )
    op.create_index(
        "idx_performance_takes_owner_created",
        "performance_takes",
        ["owner_user_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "idx_performance_takes_owner_score_created",
        "performance_takes",
        ["owner_user_id", "linked_score_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_performance_takes_linked_score_id"),
        "performance_takes",
        ["linked_score_id"],
        unique=False,
    )
    op.create_table(
        "score_deletion_operations",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("operation_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=True),
        sa.Column("score_uuid", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=False),
        sa.Column("originating_request_id", sa.String(length=64), nullable=True),
        sa.Column("traceparent", sa.String(length=55), nullable=True),
        sa.Column("tracestate", sa.String(length=512), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "COMPLETED",
                "FAILED",
                name="scoredeletionoperationstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_score_deletion_operations_failure_facts",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_score_deletion_attempt_token",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_score_deletion_attempt_count"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_uuid"),
        sa.UniqueConstraint("score_id"),
        sa.UniqueConstraint("score_uuid"),
    )
    op.create_index(
        "idx_score_deletion_due",
        "score_deletion_operations",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_score_deletion_operations_originating_request_id"),
        "score_deletion_operations",
        ["originating_request_id"],
        unique=False,
    )
    op.create_table(
        "score_input_assets",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("asset_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("upload_id", sa.BigInteger(), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["upload_id"], ["uploads.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_uuid"),
        sa.UniqueConstraint("score_id", "upload_id", name="uq_score_input_assets_score_upload"),
    )
    op.create_index(
        "idx_score_input_assets_score_order",
        "score_input_assets",
        ["score_id", "sort_order"],
        unique=False,
    )
    op.create_index(
        "idx_score_input_assets_upload", "score_input_assets", ["upload_id"], unique=False
    )
    op.create_table(
        "score_invites",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("invite_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column(
            "role",
            postgresql.ENUM(
                "VIEWER", "PRACTITIONER", "EDITOR", name="membershiprole", create_type=False
            ),
            nullable=False,
        ),
        sa.Column(
            "terminal_outcome",
            postgresql.ENUM(
                "ACCEPTED",
                "DECLINED",
                "REVOKED",
                "RECIPIENT_ACCOUNT_CLOSED",
                "INVITER_ACCOUNT_CLOSED",
                name="inviteterminaloutcome",
                create_type=False,
            ),
            nullable=True,
        ),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("terminal_actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("terminal_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(terminal_outcome NOT IN ('RECIPIENT_ACCOUNT_CLOSED','INVITER_ACCOUNT_CLOSED') OR (email IS NULL AND token_hash IS NULL AND terminal_actor_user_id IS NULL)) AND (terminal_outcome != 'INVITER_ACCOUNT_CLOSED' OR created_by_user_id IS NULL)",
            name="ck_score_invites_closed_facts",
        ),
        sa.CheckConstraint(
            "(email IS NOT NULL AND token_hash IS NOT NULL) OR (terminal_outcome IS NOT NULL AND email IS NULL AND token_hash IS NULL)",
            name="ck_score_invites_contact_facts",
        ),
        sa.CheckConstraint(
            "(terminal_outcome IS NULL AND terminal_at IS NULL AND terminal_actor_user_id IS NULL) OR (terminal_outcome IS NOT NULL AND terminal_at IS NOT NULL)",
            name="ck_score_invites_terminal_facts",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invite_uuid"),
    )
    op.create_index(
        "idx_score_invites_creator", "score_invites", ["created_by_user_id", "id"], unique=False
    )
    op.create_index(
        "idx_score_invites_email_unresolved_created",
        "score_invites",
        ["email", "created_at", "id"],
        unique=False,
        postgresql_where=sa.text("terminal_outcome IS NULL"),
        sqlite_where=sa.text("terminal_outcome IS NULL"),
    )
    op.create_index(
        "idx_score_invites_recipient_created",
        "score_invites",
        ["email", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "idx_score_invites_score_created",
        "score_invites",
        ["score_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "idx_score_invites_terminal_actor",
        "score_invites",
        ["terminal_actor_user_id", "id"],
        unique=False,
    )
    op.create_index("idx_score_invites_token_hash", "score_invites", ["token_hash"], unique=True)
    op.create_table(
        "score_library_organizations",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("folder_id", sa.BigInteger(), nullable=True),
        sa.Column("is_favorite", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["folder_id"], ["score_library_folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "score_id", name="uq_score_library_organizations_user_score"
        ),
    )
    op.create_index(
        "idx_score_library_organizations_user_favorite",
        "score_library_organizations",
        ["user_id", "is_favorite"],
        unique=False,
    )
    op.create_index(
        "idx_score_library_organizations_user_folder",
        "score_library_organizations",
        ["user_id", "folder_id"],
        unique=False,
    )
    op.create_table(
        "score_memberships",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM(
                "VIEWER", "PRACTITIONER", "EDITOR", name="membershiprole", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("score_id", "user_id", name="uq_score_memberships_score_user"),
    )
    op.create_index(
        "idx_score_memberships_creator",
        "score_memberships",
        ["created_by_user_id", "id"],
        unique=False,
    )
    op.create_index(
        "idx_score_memberships_score_active_created",
        "score_memberships",
        ["score_id", "created_at", "id"],
        unique=False,
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "idx_score_memberships_user_active",
        "score_memberships",
        ["user_id", "revoked_at"],
        unique=False,
    )
    op.create_table(
        "score_revisions",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("revision_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column(
            "origin",
            postgresql.ENUM("OMR", "EDIT", "IMPORT", name="revisionorigin", create_type=False),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision_number >= 1", name="ck_score_revisions_number_positive"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("revision_uuid"),
        sa.UniqueConstraint("score_id", "id", name="uq_score_revisions_score_id_id"),
        sa.UniqueConstraint(
            "score_id", "idempotency_key", name="uq_score_revisions_score_idempotency_key"
        ),
        sa.UniqueConstraint("score_id", "revision_number", name="uq_score_revisions_score_number"),
    )
    op.create_index(
        "idx_score_revisions_score_created",
        "score_revisions",
        ["score_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "upload_creation_requests",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("upload_session_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("client_request_id", sa.String(length=128), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("quota_hold_id", sa.BigInteger(), nullable=False),
        sa.Column("upload_id", sa.BigInteger(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "upload_id IS NULL OR completed_at IS NOT NULL", name="ck_upload_creation_completion"
        ),
        sa.ForeignKeyConstraint(["quota_hold_id"], ["storage_quota_holds.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["upload_id"], ["uploads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["upload_session_id"], ["upload_sessions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("quota_hold_id"),
        sa.UniqueConstraint("upload_id"),
        sa.UniqueConstraint("upload_session_id"),
        sa.UniqueConstraint("user_id", "client_request_id", name="uq_upload_creation_user_request"),
    )
    op.create_table(
        "playback_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("originating_request_id", sa.String(length=64), nullable=True),
        sa.Column("traceparent", sa.String(length=55), nullable=True),
        sa.Column("tracestate", sa.String(length=512), nullable=True),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "asset_kind",
            postgresql.ENUM("AUDIO", name="playbackassetkind", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "COMPLETED",
                "FAILED",
                "SUPERSEDED",
                name="playbackoutboxstatus",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_playback_outbox_failure_facts",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_playback_outbox_attempt_token",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_playback_outbox_attempt_count"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_uuid"),
        sa.UniqueConstraint("revision_id", "asset_kind", name="uq_playback_outbox_revision_kind"),
    )
    op.create_index(
        "idx_playback_outbox_dispatched",
        "playback_outbox",
        ["status", "dispatched_at"],
        unique=False,
    )
    op.create_index(
        "idx_playback_outbox_status_available",
        "playback_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_playback_outbox_originating_request_id"),
        "playback_outbox",
        ["originating_request_id"],
        unique=False,
    )
    op.create_table(
        "practice_activities",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("activity_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("client_session_id", sa.String(length=128), nullable=False),
        sa.Column("bundle_id", sa.String(length=128), nullable=False),
        sa.Column(
            "mode",
            sa.Enum(
                "STEP_BY_STEP",
                "CONTINUOUS_PLAY",
                name="ck_practice_activities_mode",
                native_enum=False,
                create_constraint=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "input_source",
            sa.Enum(
                "MICROPHONE",
                "MIDI",
                name="ck_practice_activities_input_source",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column(
            "scope_kind",
            sa.Enum(
                "FULL",
                "RANGE",
                name="ck_practice_activities_scope_kind",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("scope_start_tick", sa.BigInteger(), nullable=False),
        sa.Column("scope_terminal_tick", sa.BigInteger(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "input_source IN ('MICROPHONE', 'MIDI')", name="ck_practice_activities_input_source"
        ),
        sa.CheckConstraint(
            "mode IN ('STEP_BY_STEP', 'CONTINUOUS_PLAY')", name="ck_practice_activities_mode"
        ),
        sa.CheckConstraint(
            "scope_kind IN ('FULL', 'RANGE')", name="ck_practice_activities_scope_kind"
        ),
        sa.CheckConstraint("scope_start_tick >= 0", name="ck_practice_activities_scope_start"),
        sa.CheckConstraint(
            "scope_terminal_tick > scope_start_tick", name="ck_practice_activities_scope_terminal"
        ),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("activity_uuid"),
        sa.UniqueConstraint(
            "user_id", "client_session_id", name="uq_practice_activities_user_session"
        ),
    )
    op.create_index(
        "idx_practice_activities_revision_completed",
        "practice_activities",
        ["revision_id", "completed_at"],
        unique=False,
    )
    op.create_index(
        "idx_practice_activities_user_completed",
        "practice_activities",
        ["user_id", "completed_at"],
        unique=False,
    )
    op.create_table(
        "revision_metadata_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("originating_request_id", sa.String(length=64), nullable=True),
        sa.Column("traceparent", sa.String(length=55), nullable=True),
        sa.Column("tracestate", sa.String(length=512), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "FAILED",
                "COMPLETED",
                name="ck_revision_metadata_status",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_revision_metadata_token",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'FAILED', 'COMPLETED')",
            name="ck_revision_metadata_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_revision_metadata_attempts"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_uuid"),
        sa.UniqueConstraint("revision_id"),
    )
    op.create_index(
        "ix_revision_metadata_due",
        "revision_metadata_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_table(
        "score_playback_assets",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("asset_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "kind",
            postgresql.ENUM("AUDIO", name="playbackassetkind", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "stored_object_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("execution_manifest_id", sa.BigInteger(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("generator", sa.String(length=64), nullable=False),
        sa.Column("generator_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["execution_manifest_id"], ["execution_manifests.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stored_object_id"], ["stored_objects.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_uuid"),
        sa.UniqueConstraint("revision_id", "kind", name="uq_score_playback_assets_revision_kind"),
        sa.UniqueConstraint("stored_object_id", name="uq_score_playback_assets_stored_object"),
    )
    op.create_index(
        "idx_score_playback_assets_revision_kind",
        "score_playback_assets",
        ["revision_id", "kind"],
        unique=False,
    )
    op.create_index(
        op.f("ix_score_playback_assets_execution_manifest_id"),
        "score_playback_assets",
        ["execution_manifest_id"],
        unique=False,
    )
    op.create_table(
        "score_render_assets",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("asset_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "kind",
            postgresql.ENUM("RENDERED_PAGE", name="renderassetkind", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "stored_object_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("execution_manifest_id", sa.BigInteger(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("render_profile", sa.String(length=128), nullable=False),
        sa.Column("generator", sa.String(length=64), nullable=False),
        sa.Column("generator_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["execution_manifest_id"], ["execution_manifests.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stored_object_id"], ["stored_objects.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_uuid"),
        sa.UniqueConstraint(
            "revision_id",
            "kind",
            "render_profile",
            "page_number",
            name="uq_score_render_assets_rendered_variant",
        ),
        sa.UniqueConstraint("stored_object_id", name="uq_score_render_assets_stored_object"),
    )
    op.create_index(
        "idx_score_render_assets_revision_kind",
        "score_render_assets",
        ["revision_id", "kind"],
        unique=False,
    )
    op.create_index(
        op.f("ix_score_render_assets_execution_manifest_id"),
        "score_render_assets",
        ["execution_manifest_id"],
        unique=False,
    )
    op.create_table(
        "score_revision_events",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("event_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("target_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["target_revision_id"], ["score_revisions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_uuid"),
    )
    op.create_index(
        "idx_score_revision_events_revision", "score_revision_events", ["revision_id"], unique=False
    )
    op.create_index(
        "idx_score_revision_events_score_created",
        "score_revision_events",
        ["score_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "idx_score_revision_events_target_revision",
        "score_revision_events",
        ["target_revision_id"],
        unique=False,
    )
    op.create_table(
        "score_revision_metadata",
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM("PENDING", "READY", "FAILED", name="metadatastatus", create_type=False),
            nullable=False,
        ),
        sa.Column("notation_title", sa.Text(), nullable=True),
        sa.Column("measure_count", sa.Integer(), nullable=True),
        sa.Column("part_count", sa.Integer(), nullable=True),
        sa.Column("primary_key_fifths", sa.Integer(), nullable=True),
        sa.Column("primary_mode", sa.String(length=32), nullable=True),
        sa.Column(
            "key_signature_events",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column(
            "time_signature_events",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column(
            "tempo_events",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("extractor_version", sa.String(length=64), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status != 'FAILED' OR error_code IS NOT NULL",
            name="ck_score_revision_metadata_failed_with_error",
        ),
        sa.CheckConstraint(
            "status != 'READY' OR error_code IS NULL",
            name="ck_score_revision_metadata_ready_without_error",
        ),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("revision_id"),
    )
    op.create_index(
        "idx_score_revision_metadata_measure_count",
        "score_revision_metadata",
        ["measure_count"],
        unique=False,
    )
    op.create_index(
        "idx_score_revision_metadata_status", "score_revision_metadata", ["status"], unique=False
    )
    op.create_table(
        "score_revision_notes",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("author_user_id", sa.BigInteger(), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("revision_id", name="uq_score_revision_notes_revision"),
    )
    op.create_index(
        "idx_score_revision_notes_score_updated",
        "score_revision_notes",
        ["score_id", "updated_at"],
        unique=False,
    )
    op.create_table(
        "score_revision_practice_bindings",
        sa.Column(
            "revision_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column(
            "bundle_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bundle_id"], ["practice_bundles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("revision_id"),
    )
    op.create_index(
        op.f("ix_score_revision_practice_bindings_bundle_id"),
        "score_revision_practice_bindings",
        ["bundle_id"],
        unique=False,
    )
    op.create_table(
        "score_revision_render_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("originating_request_id", sa.String(length=64), nullable=True),
        sa.Column("traceparent", sa.String(length=55), nullable=True),
        sa.Column("tracestate", sa.String(length=512), nullable=True),
        sa.Column("render_profile", sa.String(length=128), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "COMPLETED",
                "FAILED",
                "SUPERSEDED",
                name="ck_score_revision_render_outbox_status",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_score_revision_render_outbox_failure_facts",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_score_revision_render_outbox_attempt_token",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED', 'SUPERSEDED')",
            name="ck_score_revision_render_outbox_status",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0", name="ck_score_revision_render_outbox_attempt_count"
        ),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_uuid"),
        sa.UniqueConstraint(
            "revision_id", "render_profile", name="uq_score_revision_render_outbox_revision_profile"
        ),
    )
    op.create_index(
        "idx_score_revision_render_outbox_dispatched",
        "score_revision_render_outbox",
        ["status", "dispatched_at"],
        unique=False,
    )
    op.create_index(
        "idx_score_revision_render_outbox_status_available",
        "score_revision_render_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_score_revision_render_outbox_originating_request_id"),
        "score_revision_render_outbox",
        ["originating_request_id"],
        unique=False,
    )
    op.create_table(
        "score_revision_sources",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("source_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "format",
            postgresql.ENUM("MUSICXML", name="revisionsourceformat", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "stored_object_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("generator", sa.String(length=64), nullable=False),
        sa.Column("generator_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stored_object_id"], ["stored_objects.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "revision_id", "format", name="uq_score_revision_sources_revision_format"
        ),
        sa.UniqueConstraint("source_uuid"),
        sa.UniqueConstraint("stored_object_id", name="uq_score_revision_sources_stored_object"),
    )
    op.create_index(
        "idx_score_revision_sources_revision_format",
        "score_revision_sources",
        ["revision_id", "format"],
        unique=False,
    )
    op.create_table(
        "take_processing_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("operation_uuid", sa.String(length=36), nullable=False),
        sa.Column("take_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "FAILED",
                "COMPLETED",
                name="ck_take_processing_status",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_detail", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_stage", sa.String(length=64), nullable=True),
        sa.Column("failure_classification", sa.String(length=32), nullable=True),
        sa.Column("failure_retryable", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_take_processing_failure",
        ),
        sa.CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_take_processing_token",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'FAILED', 'COMPLETED')",
            name="ck_take_processing_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_take_processing_attempts"),
        sa.ForeignKeyConstraint(["take_id"], ["performance_takes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_uuid"),
        sa.UniqueConstraint("take_id"),
    )
    op.create_index(
        "ix_take_processing_due",
        "take_processing_outbox",
        ["status", "next_attempt_at"],
        unique=False,
    )

    op.create_foreign_key(
        "fk_scores_head_revision",
        "scores",
        "score_revisions",
        ["id", "head_revision_id"],
        ["score_id", "id"],
    )
    policies = sa.table(
        "storage_plan_policies",
        sa.column("plan_code", sa.String()),
        sa.column("default_limit_bytes", sa.BigInteger()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    from datetime import datetime, UTC

    now = datetime.now(UTC)
    op.bulk_insert(
        policies,
        [
            {"plan_code": code, "default_limit_bytes": size, "created_at": now, "updated_at": now}
            for code, size in (("FREE", 104857600), ("PLUS", 5368709120), ("PRO", 21474836480))
        ],
    )


def downgrade() -> None:
    op.drop_constraint("fk_scores_head_revision", "scores", type_="foreignkey")
    op.drop_index("ix_take_processing_due", table_name="take_processing_outbox")
    op.drop_table("take_processing_outbox")
    op.drop_index("idx_score_revision_sources_revision_format", table_name="score_revision_sources")
    op.drop_table("score_revision_sources")
    op.drop_index(
        op.f("ix_score_revision_render_outbox_originating_request_id"),
        table_name="score_revision_render_outbox",
    )
    op.drop_index(
        "idx_score_revision_render_outbox_status_available",
        table_name="score_revision_render_outbox",
    )
    op.drop_index(
        "idx_score_revision_render_outbox_dispatched", table_name="score_revision_render_outbox"
    )
    op.drop_table("score_revision_render_outbox")
    op.drop_index(
        op.f("ix_score_revision_practice_bindings_bundle_id"),
        table_name="score_revision_practice_bindings",
    )
    op.drop_table("score_revision_practice_bindings")
    op.drop_index("idx_score_revision_notes_score_updated", table_name="score_revision_notes")
    op.drop_table("score_revision_notes")
    op.drop_index("idx_score_revision_metadata_status", table_name="score_revision_metadata")
    op.drop_index("idx_score_revision_metadata_measure_count", table_name="score_revision_metadata")
    op.drop_table("score_revision_metadata")
    op.drop_index("idx_score_revision_events_target_revision", table_name="score_revision_events")
    op.drop_index("idx_score_revision_events_score_created", table_name="score_revision_events")
    op.drop_index("idx_score_revision_events_revision", table_name="score_revision_events")
    op.drop_table("score_revision_events")
    op.drop_index(
        op.f("ix_score_render_assets_execution_manifest_id"), table_name="score_render_assets"
    )
    op.drop_index("idx_score_render_assets_revision_kind", table_name="score_render_assets")
    op.drop_table("score_render_assets")
    op.drop_index(
        op.f("ix_score_playback_assets_execution_manifest_id"), table_name="score_playback_assets"
    )
    op.drop_index("idx_score_playback_assets_revision_kind", table_name="score_playback_assets")
    op.drop_table("score_playback_assets")
    op.drop_index("ix_revision_metadata_due", table_name="revision_metadata_outbox")
    op.drop_table("revision_metadata_outbox")
    op.drop_index("idx_practice_activities_user_completed", table_name="practice_activities")
    op.drop_index("idx_practice_activities_revision_completed", table_name="practice_activities")
    op.drop_table("practice_activities")
    op.drop_index(op.f("ix_playback_outbox_originating_request_id"), table_name="playback_outbox")
    op.drop_index("idx_playback_outbox_status_available", table_name="playback_outbox")
    op.drop_index("idx_playback_outbox_dispatched", table_name="playback_outbox")
    op.drop_table("playback_outbox")
    op.drop_table("upload_creation_requests")
    op.drop_index("idx_score_revisions_score_created", table_name="score_revisions")
    op.drop_table("score_revisions")
    op.drop_index("idx_score_memberships_user_active", table_name="score_memberships")
    op.drop_index(
        "idx_score_memberships_score_active_created",
        table_name="score_memberships",
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )
    op.drop_index("idx_score_memberships_creator", table_name="score_memberships")
    op.drop_table("score_memberships")
    op.drop_index(
        "idx_score_library_organizations_user_folder", table_name="score_library_organizations"
    )
    op.drop_index(
        "idx_score_library_organizations_user_favorite", table_name="score_library_organizations"
    )
    op.drop_table("score_library_organizations")
    op.drop_index("idx_score_invites_token_hash", table_name="score_invites")
    op.drop_index("idx_score_invites_terminal_actor", table_name="score_invites")
    op.drop_index("idx_score_invites_score_created", table_name="score_invites")
    op.drop_index("idx_score_invites_recipient_created", table_name="score_invites")
    op.drop_index(
        "idx_score_invites_email_unresolved_created",
        table_name="score_invites",
        postgresql_where=sa.text("terminal_outcome IS NULL"),
        sqlite_where=sa.text("terminal_outcome IS NULL"),
    )
    op.drop_index("idx_score_invites_creator", table_name="score_invites")
    op.drop_table("score_invites")
    op.drop_index("idx_score_input_assets_upload", table_name="score_input_assets")
    op.drop_index("idx_score_input_assets_score_order", table_name="score_input_assets")
    op.drop_table("score_input_assets")
    op.drop_index(
        op.f("ix_score_deletion_operations_originating_request_id"),
        table_name="score_deletion_operations",
    )
    op.drop_index("idx_score_deletion_due", table_name="score_deletion_operations")
    op.drop_table("score_deletion_operations")
    op.drop_index(op.f("ix_performance_takes_linked_score_id"), table_name="performance_takes")
    op.drop_index("idx_performance_takes_owner_score_created", table_name="performance_takes")
    op.drop_index("idx_performance_takes_owner_created", table_name="performance_takes")
    op.drop_table("performance_takes")
    op.drop_index("idx_import_job_uploads_job", table_name="import_job_uploads")
    op.drop_table("import_job_uploads")
    op.drop_table("guest_preview_credentials")
    op.drop_index("idx_uploads_user_created", table_name="uploads")
    op.drop_index("idx_uploads_stored_object", table_name="uploads")
    op.drop_table("uploads")
    op.drop_index("idx_scores_owner_updated", table_name="scores")
    op.drop_index("idx_scores_owner_active_updated", table_name="scores")
    op.drop_table("scores")
    op.drop_index(
        "ix_take_upload_reservation_status_expires",
        table_name="performance_take_upload_reservations",
    )
    op.drop_index(
        op.f("ix_performance_take_upload_reservations_user_id"),
        table_name="performance_take_upload_reservations",
    )
    op.drop_index(
        op.f("ix_performance_take_upload_reservations_reservation_uuid"),
        table_name="performance_take_upload_reservations",
    )
    op.drop_index(
        op.f("ix_performance_take_upload_reservations_manifest_id"),
        table_name="performance_take_upload_reservations",
    )
    op.drop_index(
        op.f("ix_performance_take_upload_reservations_client_request_id"),
        table_name="performance_take_upload_reservations",
    )
    op.drop_table("performance_take_upload_reservations")
    op.drop_index("idx_import_job_steps_job_order", table_name="import_job_steps")
    op.drop_table("import_job_steps")
    op.drop_index(
        op.f("ix_import_dispatches_originating_request_id"), table_name="import_dispatches"
    )
    op.drop_index("idx_import_dispatch_due", table_name="import_dispatches")
    op.drop_table("import_dispatches")
    op.drop_index("idx_import_artifacts_job_kind", table_name="import_artifacts")
    op.drop_table("import_artifacts")
    op.drop_table("user_storage_entitlements")
    op.drop_index("ix_upload_session_user_status", table_name="upload_sessions")
    op.drop_index("ix_upload_session_expiry", table_name="upload_sessions")
    op.drop_index("ix_upload_session_cleanup", table_name="upload_sessions")
    op.drop_table("upload_sessions")
    op.drop_index("idx_storage_usage_events_user_created", table_name="storage_usage_events")
    op.drop_index("idx_storage_usage_events_object", table_name="storage_usage_events")
    op.drop_table("storage_usage_events")
    op.drop_index("idx_storage_usage_counters_user", table_name="storage_usage_counters")
    op.drop_table("storage_usage_counters")
    op.drop_table("storage_usage_accounts")
    op.drop_index("idx_storage_quota_holds_user_status_expiry", table_name="storage_quota_holds")
    op.drop_index("idx_storage_quota_holds_status_expiry", table_name="storage_quota_holds")
    op.drop_table("storage_quota_holds")
    op.drop_table("score_library_folders")
    op.drop_table("user_sessions")
    op.drop_table("realtime_stream_state")
    op.drop_index("idx_realtime_changes_created", table_name="realtime_changes")
    op.drop_table("realtime_changes")
    op.drop_index("ix_take_manifest_user_created", table_name="performance_take_manifests")
    op.drop_index(
        op.f("ix_performance_take_manifests_user_id"), table_name="performance_take_manifests"
    )
    op.drop_index(
        op.f("ix_performance_take_manifests_take_uuid"), table_name="performance_take_manifests"
    )
    op.drop_table("performance_take_manifests")
    op.drop_index("idx_operator_recovery_codes_owner", table_name="operator_recovery_codes")
    op.drop_table("operator_recovery_codes")
    op.drop_index(
        "idx_operator_mfa_challenges_operator_expiry", table_name="operator_mfa_challenges"
    )
    op.drop_table("operator_mfa_challenges")
    op.drop_index("idx_operator_sessions_expiry", table_name="operator_sessions")
    op.drop_index("idx_operator_sessions_operator_created", table_name="operator_sessions")
    op.drop_table("operator_sessions")
    op.drop_index("idx_notifications_recipient_read", table_name="notifications")
    op.drop_index("idx_notifications_recipient_created", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index(op.f("ix_import_jobs_execution_manifest_id"), table_name="import_jobs")
    op.drop_index("idx_import_jobs_user_created", table_name="import_jobs")
    op.drop_index("idx_import_jobs_state", table_name="import_jobs")
    op.drop_table("import_jobs")
    op.drop_index("idx_email_change_requests_user_created", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_token_hash", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_new_email", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_expires", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_consumed", table_name="email_change_requests")
    op.drop_table("email_change_requests")
    op.drop_index("idx_auth_tokens_user_purpose", table_name="auth_tokens")
    op.drop_index("idx_auth_tokens_used", table_name="auth_tokens")
    op.drop_index("idx_auth_tokens_expires", table_name="auth_tokens")
    op.drop_table("auth_tokens")
    op.drop_index("ix_account_deletion_due", table_name="account_deletion_operations")
    op.drop_table("account_deletion_operations")
    op.drop_index(op.f("ix_users_avatar_object_id"), table_name="users")
    op.drop_table("users")
    op.drop_index("ix_object_retirement_due", table_name="stored_object_retirements")
    op.drop_table("stored_object_retirements")
    op.drop_index("ix_practice_bundles_status_creation", table_name="practice_bundles")
    op.drop_table("practice_bundles")
    op.drop_index("idx_ops_audit_events_action_created", table_name="ops_audit_events")
    op.drop_index("idx_ops_audit_events_actor_created", table_name="ops_audit_events")
    op.drop_index("idx_ops_audit_events_operation", table_name="ops_audit_events")
    op.drop_table("ops_audit_events")
    op.drop_index("ix_stored_objects_sha256", table_name="stored_objects")
    op.drop_table("stored_objects")
    op.drop_table("storage_plan_policies")
    op.drop_table("scheduler_leader_statuses")
    op.drop_index("idx_scheduler_heartbeats_last_success", table_name="scheduler_heartbeats")
    op.drop_index("idx_scheduler_heartbeats_job_key", table_name="scheduler_heartbeats")
    op.drop_table("scheduler_heartbeats")
    op.drop_index("idx_pending_registrations_token_hash", table_name="pending_registrations")
    op.drop_index("idx_pending_registrations_expires", table_name="pending_registrations")
    op.drop_index("idx_pending_registrations_email", table_name="pending_registrations")
    op.drop_index("idx_pending_registrations_consumed", table_name="pending_registrations")
    op.drop_table("pending_registrations")
    op.drop_index("idx_operators_status_role", table_name="operators")
    op.drop_table("operators")
    op.drop_index("ix_object_write_intent_due", table_name="object_write_intents")
    op.drop_table("object_write_intents")
    op.drop_index(op.f("ix_mail_outbox_originating_request_id"), table_name="mail_outbox")
    op.drop_index("idx_mail_outbox_status_available", table_name="mail_outbox")
    op.drop_index("idx_mail_outbox_source", table_name="mail_outbox")
    op.drop_index("idx_mail_outbox_dispatched", table_name="mail_outbox")
    op.drop_index("idx_mail_outbox_created", table_name="mail_outbox")
    op.drop_table("mail_outbox")
    op.drop_table("execution_manifests")
    op.execute("DROP TYPE storageusagecategory")
    op.execute("DROP TYPE scoredeletionoperationstatus")
    op.execute("DROP TYPE revisionsourceformat")
    op.execute("DROP TYPE revisionorigin")
    op.execute("DROP TYPE renderassetkind")
    op.execute("DROP TYPE playbackoutboxstatus")
    op.execute("DROP TYPE playbackassetkind")
    op.execute("DROP TYPE operatorstatus")
    op.execute("DROP TYPE operatorrole")
    op.execute("DROP TYPE operatorchallengepurpose")
    op.execute("DROP TYPE metadatastatus")
    op.execute("DROP TYPE membershiprole")
    op.execute("DROP TYPE mailoutboxstatus")
    op.execute("DROP TYPE inviteterminaloutcome")
    op.execute("DROP TYPE importjobstepstatus")
    op.execute("DROP TYPE importjobstate")
    op.execute("DROP TYPE importdispatchstatus")
    op.execute("DROP TYPE importartifactkind")
    op.execute("DROP TYPE sessionrevocationreason")
