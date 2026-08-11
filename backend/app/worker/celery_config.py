"""Celery configuration shared by worker and beat processes."""
import os
from pathlib import Path

from celery import Celery, signals
from app.core.config import settings
from app.core.logging_setup import configure_celery_logging
from app.worker.beat_schedule import build_beat_schedule

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
    beat_schedule=build_beat_schedule(settings),
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


@signals.worker_process_init.connect
def setup_worker_tracing(**_: object) -> None:
    """Create a tracer provider inside each forked Celery worker process."""

    from app.core.background_tracing import configure_background_tracing

    configure_background_tracing()
