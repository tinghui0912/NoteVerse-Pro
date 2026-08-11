"""Celery runtime option contract for worker and beat processes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.core.settings.task_reliability import TaskReliabilitySettings
from app.worker.beat_schedule import build_beat_schedule


CeleryRuntimeOptions = dict[str, Any]


def build_celery_runtime_options(
    settings: Settings,
    task_reliability_settings: TaskReliabilitySettings,
    *,
    beat_schedule_filename: Path,
) -> CeleryRuntimeOptions:
    """Build Celery options that are owned by the backend runtime.

    The constants here are process-behavior policy, not deployment toggles. Task
    deadline values remain deployment-configurable because they must align with
    the backend processing timeout envelope.
    """

    return {
        "task_serializer": "json",
        "accept_content": ["json"],
        "result_serializer": "json",
        "timezone": "UTC",
        "enable_utc": True,
        "task_track_started": True,
        "task_acks_late": True,
        "task_reject_on_worker_lost": True,
        "task_acks_on_failure_or_timeout": True,
        "task_soft_time_limit": task_reliability_settings.CELERY_TASK_SOFT_TIME_LIMIT,
        "task_time_limit": task_reliability_settings.CELERY_TASK_TIME_LIMIT,
        "broker_connection_timeout": 2,
        "broker_transport_options": {
            "socket_connect_timeout": 2,
            "socket_timeout": 2,
            "retry_on_timeout": False,
            "max_retries": 1,
        },
        "result_backend_transport_options": {
            "socket_connect_timeout": 2,
            "socket_timeout": 2,
            "retry_on_timeout": False,
        },
        "worker_prefetch_multiplier": 1,
        "worker_max_tasks_per_child": 50,
        "worker_hijack_root_logger": False,
        "result_expires": 3600,
        "beat_schedule_filename": str(beat_schedule_filename),
        "beat_schedule": build_beat_schedule(settings),
    }
