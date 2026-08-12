"""Celery Beat schedule contract for NoteVerse background maintenance."""

from __future__ import annotations

from typing import Any

from app.core.config import Settings


BeatSchedule = dict[str, dict[str, Any]]


def build_beat_schedule(settings: Settings) -> BeatSchedule:
    """Build the recurring background-maintenance schedule.

    Schedule intervals stay in the shared runtime settings because the related
    retry, lease, and retention policies are also read by API/Ops projections
    and Worker dispatch services. This module owns only the mapping from policy
    values to Celery Beat task entries.
    """

    return {
        "job-maintenance-every-five-minutes": {
            "task": "app.worker.tasks.run_job_maintenance",
            "schedule": 300.0,
        },
        "import-dispatch-maintenance": {
            "task": "app.worker.tasks.run_import_dispatch_maintenance",
            "schedule": float(settings.IMPORT_DISPATCH_INTERVAL_SECONDS),
        },
        "notification-maintenance": {
            "task": "app.worker.tasks.run_notification_maintenance",
            "schedule": float(settings.NOTIFICATION_CLEANUP_INTERVAL_SECONDS),
        },
        "realtime-maintenance": {
            "task": "app.worker.tasks.run_realtime_maintenance",
            "schedule": float(settings.REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS),
        },
        "derived-asset-cleanup": {
            "task": "app.worker.tasks.run_derived_asset_cleanup",
            "schedule": float(settings.DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS),
        },
        "score-deletion-cleanup": {
            "task": "app.worker.tasks.run_score_deletion_cleanup",
            "schedule": float(settings.SCORE_DELETION_CLEANUP_INTERVAL_SECONDS),
        },
        "render-outbox-maintenance": {
            "task": "app.worker.tasks.run_render_outbox_maintenance",
            "schedule": float(settings.RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS),
        },
        "playback-outbox-maintenance": {
            "task": "app.worker.tasks.run_playback_outbox_maintenance",
            "schedule": float(settings.PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS),
        },
        "mail-outbox-maintenance": {
            "task": "app.worker.tasks.run_mail_outbox_maintenance",
            "schedule": float(settings.MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS),
        },
        "mail-outbox-cleanup-daily": {
            "task": "app.worker.tasks.run_mail_outbox_cleanup",
            "schedule": 86400.0,
        },
    }
