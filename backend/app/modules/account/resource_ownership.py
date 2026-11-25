"""Explicit User-FK ownership review contract, not a runtime cleanup registry.

Domain cleanup remains explicit application composition. Adding an ownership edge
requires a reviewed policy and a matching domain lifecycle, not inferred cascades.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class AccountResourcePolicy:
    table: str
    user_column: str
    domain: str
    ownership: Literal["owned", "shared", "history", "system"]
    erasure: str


ACCOUNT_RESOURCE_POLICIES = (
    AccountResourcePolicy(
        "account_deletion_operations",
        "user_id",
        "account",
        "system",
        "SET NULL after finalization; operation UUID and numeric subject snapshot remain for recovery",
    ),
    AccountResourcePolicy(
        "auth_tokens",
        "user_id",
        "auth",
        "owned",
        "Bounded authentication erasure after closure revokes access",
    ),
    AccountResourcePolicy(
        "email_change_requests",
        "user_id",
        "account",
        "owned",
        "Bounded Account security erasure before identity removal",
    ),
    AccountResourcePolicy(
        "import_jobs",
        "user_id",
        "import_jobs",
        "owned",
        "Domain cleanup deletes artifacts and releases TEMP_IMPORT",
    ),
    AccountResourcePolicy(
        "notifications",
        "recipient_user_id",
        "notifications",
        "owned",
        "erase_recipient_history before User deletion",
    ),
    AccountResourcePolicy(
        "performance_take_manifests",
        "user_id",
        "performance_takes",
        "owned",
        "erase history only after staging and candidate cleanup ACK",
    ),
    AccountResourcePolicy(
        "performance_take_upload_reservations",
        "user_id",
        "performance_takes",
        "owned",
        "cancel business reservation; release hold; retain temporary cleanup lineage until ACK",
    ),
    AccountResourcePolicy(
        "playback_outbox",
        "requested_by_user_id",
        "playback",
        "history",
        "SET NULL; another owner retains playback work",
    ),
    AccountResourcePolicy(
        "practice_activities", "user_id", "practice", "owned", "Bounded Practice activity erasure"
    ),
    AccountResourcePolicy(
        "realtime_changes",
        "recipient_user_id",
        "realtime",
        "owned",
        "Bounded recipient replay erasure",
    ),
    AccountResourcePolicy(
        "realtime_stream_state",
        "recipient_user_id",
        "realtime",
        "owned",
        "CASCADE private replay cursor",
    ),
    AccountResourcePolicy(
        "refresh_tokens",
        "user_id",
        "auth",
        "owned",
        "revoke immediately; bounded credential erasure",
    ),
    AccountResourcePolicy(
        "score_invites",
        "created_by_user_id",
        "collaboration",
        "owned",
        "Owned Score deletion removes invites; foreign Score belongs to its owner",
    ),
    AccountResourcePolicy(
        "score_library_folders", "user_id", "library", "owned", "erase_user_state"
    ),
    AccountResourcePolicy(
        "score_library_organizations",
        "user_id",
        "library",
        "owned",
        "erase_user_state without deleting foreign Scores",
    ),
    AccountResourcePolicy(
        "score_memberships",
        "user_id",
        "collaboration",
        "shared",
        "erase_user_memberships preserves foreign Score",
    ),
    AccountResourcePolicy(
        "score_memberships",
        "created_by_user_id",
        "collaboration",
        "owned",
        "Score owner created membership; owned Score erasure removes it",
    ),
    AccountResourcePolicy(
        "score_revision_events",
        "actor_user_id",
        "revisions",
        "history",
        "SET NULL preserves foreign Score history",
    ),
    AccountResourcePolicy(
        "score_revision_notes",
        "author_user_id",
        "revisions",
        "history",
        "SET NULL preserves foreign Score note",
    ),
    AccountResourcePolicy(
        "score_revision_render_outbox",
        "requested_by_user_id",
        "revisions",
        "history",
        "SET NULL preserves foreign render work",
    ),
    AccountResourcePolicy(
        "score_revisions",
        "created_by_user_id",
        "revisions",
        "history",
        "SET NULL preserves foreign Score revision",
    ),
    AccountResourcePolicy(
        "scores",
        "owner_user_id",
        "scores",
        "owned",
        "ScoreLifecycleService and ScoreDeletionExecutor release graph and accounting",
    ),
    AccountResourcePolicy(
        "storage_quota_holds",
        "user_id",
        "storage_quota",
        "owned",
        "release HELD; erase terminal holds after business lineage",
    ),
    AccountResourcePolicy(
        "storage_usage_accounts", "user_id", "storage_usage", "owned", "assert zero then CASCADE"
    ),
    AccountResourcePolicy(
        "storage_usage_counters",
        "user_id",
        "storage_usage",
        "owned",
        "assert every category zero then CASCADE",
    ),
    AccountResourcePolicy(
        "storage_usage_events",
        "user_id",
        "storage_usage",
        "owned",
        "Bounded erasure after verified semantic release; events do not establish ownership",
    ),
    AccountResourcePolicy(
        "upload_creation_requests",
        "user_id",
        "uploads",
        "owned",
        "erase command history after semantic Upload erasure",
    ),
    AccountResourcePolicy(
        "uploads",
        "uploader_user_id",
        "uploads",
        "owned",
        "delete_upload releases standalone UPLOAD and retires only unreferenced object",
    ),
    AccountResourcePolicy(
        "user_storage_entitlements",
        "user_id",
        "storage_quota",
        "owned",
        "CASCADE after holds released and usage verified zero",
    ),
)
