"""Generated from contracts/realtime/events.schema.json. Do not edit."""

from enum import StrEnum


class RealtimeChangeKind(StrEnum):
    NOTIFICATIONS_CHANGED = "notifications.changed"
    SCORE_REVISIONS_CHANGED = "score.revisions.changed"
    SCORE_DERIVED_ASSETS_CHANGED = "score.derived_assets.changed"
    SCORE_METADATA_CHANGED = "score.metadata.changed"
    IMPORT_JOBS_CHANGED = "import_jobs.changed"
