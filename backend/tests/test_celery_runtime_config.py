from app.core.config import settings
from app.core.settings.task_reliability import get_task_reliability_settings
from app.core.settings.worker_runtime import get_worker_runtime_settings
from app.worker.beat_schedule import build_beat_schedule
from app.worker.celery_config import celery_app
from app.worker.celery_runtime_options import build_celery_runtime_options


def test_task_time_limits_form_ordered_shutdown_envelope() -> None:
    task_settings = get_task_reliability_settings()

    assert get_worker_runtime_settings().PADDLEOCR_TIMEOUT_SECONDS <= task_settings.MAX_PROCESSING_TIME
    assert task_settings.MAX_PROCESSING_TIME < task_settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert task_settings.CELERY_TASK_SOFT_TIME_LIMIT < task_settings.CELERY_TASK_TIME_LIMIT


def test_celery_uses_explicit_task_time_limits() -> None:
    task_settings = get_task_reliability_settings()

    assert celery_app.conf.task_soft_time_limit == task_settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert celery_app.conf.task_time_limit == task_settings.CELERY_TASK_TIME_LIMIT


def test_celery_uses_the_declared_beat_schedule_contract() -> None:
    assert celery_app.conf.beat_schedule == build_beat_schedule(settings)


def test_celery_uses_the_declared_runtime_options_contract() -> None:
    expected = build_celery_runtime_options(
        settings,
        get_task_reliability_settings(),
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
    render_outbox_schedule = celery_app.conf.beat_schedule["render-outbox-maintenance"]

    assert derived_asset_schedule["schedule"] == float(settings.DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS)
    assert render_outbox_schedule["schedule"] == float(settings.RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS)


def test_playback_delivery_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["playback-outbox-maintenance"]

    assert schedule["schedule"] == float(settings.PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS)


def test_practice_replay_object_deletion_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule[
        "practice-replay-object-deletion-maintenance"
    ]

    assert (
        schedule["task"]
        == "app.worker.tasks.run_practice_replay_object_deletion_maintenance"
    )
    assert schedule["schedule"] == float(
        settings.PRACTICE_REPLAY_DELETE_OUTBOX_DISPATCH_INTERVAL_SECONDS
    )


def test_mail_delivery_maintenance_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["mail-outbox-maintenance"]

    assert schedule["schedule"] == float(settings.MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS)


def test_score_deletion_cleanup_is_scheduled() -> None:
    schedule = celery_app.conf.beat_schedule["score-deletion-cleanup"]

    assert schedule["task"] == "app.worker.tasks.run_score_deletion_cleanup"
    assert schedule["schedule"] == float(settings.SCORE_DELETION_CLEANUP_INTERVAL_SECONDS)
