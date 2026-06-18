from app.core.config import settings
from app.worker.celery_config import celery_app


def test_task_time_limits_form_ordered_shutdown_envelope() -> None:
    assert settings.PADDLEOCR_TIMEOUT_SECONDS <= settings.MAX_PROCESSING_TIME
    assert settings.MAX_PROCESSING_TIME < settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT < settings.CELERY_TASK_TIME_LIMIT


def test_celery_uses_explicit_task_time_limits() -> None:
    assert celery_app.conf.task_soft_time_limit == settings.CELERY_TASK_SOFT_TIME_LIMIT
    assert celery_app.conf.task_time_limit == settings.CELERY_TASK_TIME_LIMIT
