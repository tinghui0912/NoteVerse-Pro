"""
Celery configuration for FastAPI backend.
Uses synchronous database sessions for worker tasks.
"""
from celery import Celery
from app.core.config import settings

# Create Celery app
celery_app = Celery(
    'melody_forge_worker',
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND
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
    task_time_limit=int(settings.MAX_PROCESSING_TIME) + 60,  # Add buffer
    task_soft_time_limit=int(settings.MAX_PROCESSING_TIME),
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=50,
    result_expires=3600,
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
