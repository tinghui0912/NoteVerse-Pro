from app.core.config import get_worker_runtime_settings, settings
from app.worker.celery_config import celery_app


def test_task_time_limits_form_ordered_shutdown_envelope() -> None:
    assert get_worker_runtime_settings().PADDLEOCR_TIMEOUT_SECONDS <= settings.MAX_PROCESSING_TIME
    assert settings.MAX_PROCESSING_TIME < settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT < settings.CELERY_TASK_TIME_LIMIT


def test_celery_uses_explicit_task_time_limits() -> None:
    assert celery_app.conf.task_soft_time_limit == settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert celery_app.conf.task_time_limit == settings.CELERY_TASK_TIME_LIMIT


def test_notification_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["notification-maintenance"]

    assert schedule["task"] == "app.worker.tasks.run_notification_maintenance"
    assert schedule["schedule"] == float(settings.NOTIFICATION_CLEANUP_INTERVAL_SECONDS)


def test_realtime_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["realtime-maintenance"]

    assert schedule["task"] == "app.worker.tasks.run_realtime_maintenance"
    assert schedule["schedule"] == float(settings.REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS)


def test_render_asset_delivery_maintenance_is_scheduled() -> None:
    derived_asset_schedule = celery_app.conf.beat_schedule["derived-asset-cleanup"]
    render_outbox_schedule = celery_app.conf.beat_schedule["render-outbox-maintenance"]

    assert derived_asset_schedule["schedule"] == float(settings.DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS)
    assert render_outbox_schedule["schedule"] == float(settings.RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS)


def test_playback_delivery_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["playback-outbox-maintenance"]

    assert schedule["schedule"] == float(settings.PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS)


def test_score_deletion_cleanup_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["score-deletion-cleanup"]

    assert schedule["task"] == "app.worker.tasks.run_score_deletion_cleanup"
    assert schedule["schedule"] == float(settings.SCORE_DELETION_CLEANUP_INTERVAL_SECONDS)
