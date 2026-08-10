from app.core.settings.queue import QueueSettings


def test_queue_settings_keep_redis_and_celery_connections_explicit() -> None:
    settings = QueueSettings(
        REDIS_URL="redis://redis/0",
        CELERY_BROKER_URL="redis://redis/1",
        CELERY_RESULT_BACKEND="redis://redis/2",
    )

    assert settings.CELERY_BROKER_URL.endswith("/1")
