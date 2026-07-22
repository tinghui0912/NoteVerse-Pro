"""Celery configuration shared by worker and beat processes."""
import os
from pathlib import Path

from celery import Celery, signals
from app.core.config import settings
from app.core.logging_setup import configure_celery_logging

beat_state_dir = Path(settings.WORK_ROOT) / "celerybeat"
beat_state_dir.mkdir(parents=True, exist_ok=True)
beat_schedule_filename = beat_state_dir / "celerybeat-schedule"
task_modules = ["app.worker.tasks"] if os.getenv("NOTEVERSE_CELERY_IMPORT_TASKS") == "true" else []

# Create Celery app
celery_app = Celery(
    'melody_forge_worker',
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=task_modules,
)

# Celery configuration
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_acks_on_failure_or_timeout=True,
    task_soft_time_limit=settings.CELERY_TASK_SOFT_TIME_LIMIT,
    task_time_limit=settings.CELERY_TASK_TIME_LIMIT,
    broker_connection_timeout=2,
    broker_transport_options={
        "socket_connect_timeout": 2,
        "socket_timeout": 2,
        "retry_on_timeout": False,
        "max_retries": 1,
    },
    result_backend_transport_options={
        "socket_connect_timeout": 2,
        "socket_timeout": 2,
        "retry_on_timeout": False,
    },
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50,
    worker_hijack_root_logger=False,
    result_expires=3600,
    beat_schedule_filename=str(beat_schedule_filename),
    beat_schedule={
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
    },
)

# Task routes - use default celery queue
# celery_app.conf.task_routes = {
#     'app.worker.tasks.process_single_image_task': {'queue': 'default'},
#     'app.worker.tasks.process_images_task': {'queue': 'default'},
# }

if task_modules:
    celery_app.loader.import_default_modules()


@signals.setup_logging.connect
def setup_celery_logging(**_: object) -> None:
    """Use the application logging pipeline for Celery framework logs."""

    configure_celery_logging()
