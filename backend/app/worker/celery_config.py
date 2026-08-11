"""Celery configuration shared by worker and beat processes."""
import os
from pathlib import Path

from celery import Celery, signals
from app.core.config import settings
from app.core.logging_setup import configure_celery_logging
from app.worker.celery_runtime_options import build_celery_runtime_options

beat_state_dir = Path(settings.WORK_ROOT) / "celerybeat"
beat_state_dir.mkdir(parents=True, exist_ok=True)
beat_schedule_filename = beat_state_dir / "celerybeat-schedule"
task_modules = ["app.worker.tasks"] if os.getenv("NOTEVERSE_CELERY_IMPORT_TASKS") == "true" else []

celery_app = Celery(
    'melody_forge_worker',
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=task_modules,
)

celery_app.conf.update(build_celery_runtime_options(settings, beat_schedule_filename=beat_schedule_filename))

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
