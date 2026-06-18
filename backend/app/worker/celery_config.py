"""
Celery configuration for FastAPI backend.
Uses synchronous database sessions for worker tasks.
"""
from pathlib import Path

from celery import Celery
from app.core.config import settings

beat_state_dir = Path(settings.WORK_ROOT) / "celerybeat"
beat_state_dir.mkdir(parents=True, exist_ok=True)
beat_schedule_filename = beat_state_dir / "celerybeat-schedule"

# Create Celery app
celery_app = Celery(
    'melody_forge_worker',
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.worker.tasks"],
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
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50,
    result_expires=3600,
    beat_schedule_filename=str(beat_schedule_filename),
    beat_schedule={
        "task-maintenance-every-five-minutes": {
            "task": "app.worker.tasks.run_task_maintenance",
            "schedule": 300.0,
        },
    },
)

# Task routes - use default celery queue
# celery_app.conf.task_routes = {
#     'app.worker.tasks.process_single_image_task': {'queue': 'default'},
#     'app.worker.tasks.process_images_task': {'queue': 'default'},
# }

celery_app.loader.import_default_modules()
