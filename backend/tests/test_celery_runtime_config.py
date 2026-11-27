from app.runtime.beat.settings import BeatSettings
from app.runtime.worker.settings import WorkerSettings
from app.task_queue.schedule import build_beat_schedule
from app.runtime.worker.main import celery_app
from app.task_queue.options import build_celery_runtime_options
from app.runtime.worker.context import get_context

settings = get_context().settings


def test_task_time_limits_form_ordered_shutdown_envelope() -> None:
    task_settings = BeatSettings()

    assert WorkerSettings().PADDLEOCR_TIMEOUT_SECONDS <= task_settings.MAX_PROCESSING_TIME
    assert task_settings.MAX_PROCESSING_TIME < task_settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert task_settings.CELERY_TASK_SOFT_TIME_LIMIT < task_settings.CELERY_TASK_TIME_LIMIT


def test_celery_uses_explicit_task_time_limits() -> None:
    task_settings = BeatSettings()

    assert celery_app.conf.task_soft_time_limit == task_settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert celery_app.conf.task_time_limit == task_settings.CELERY_TASK_TIME_LIMIT


def test_celery_uses_the_declared_beat_schedule_contract() -> None:
    assert celery_app.conf.beat_schedule == build_beat_schedule(settings)


def test_celery_uses_the_declared_runtime_options_contract() -> None:
    expected = build_celery_runtime_options(
        settings,
        BeatSettings(),
        beat_schedule_filename=celery_app.conf.beat_schedule_filename,
    )

    for key, value in expected.items():
        assert celery_app.conf[key] == value


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
    revision_render_schedule = celery_app.conf.beat_schedule["score-revision-render-maintenance"]

    assert derived_asset_schedule["schedule"] == float(
        settings.DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS
    )
    assert revision_render_schedule["schedule"] == float(
        settings.REVISION_RENDER_DISPATCH_INTERVAL_SECONDS
    )


def test_playback_delivery_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["playback-outbox-maintenance"]

    assert schedule["schedule"] == float(settings.PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS)


def test_stored_object_retirement_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["stored-object-retirement-maintenance"]

    assert schedule["task"] == "app.worker.tasks.run_stored_object_retirement_maintenance"
    assert schedule["schedule"] == float(
        settings.STORED_OBJECT_RETIREMENT_DISPATCH_INTERVAL_SECONDS
    )


def test_mail_delivery_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["mail-outbox-maintenance"]

    assert schedule["schedule"] == float(settings.MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS)


def test_score_deletion_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["score-deletion-maintenance"]

    assert schedule["task"] == "app.worker.tasks.run_score_deletion_maintenance"
    assert schedule["schedule"] == float(settings.SCORE_DELETION_INTERVAL_SECONDS)
