"""Explicit broker-client construction for durable task producers."""

from celery import Celery
from app.platform.config.queue import QueueSettings


def build_publisher(config: QueueSettings) -> Celery:
    sender = Celery(
        "noteverse-publisher", broker=config.CELERY_BROKER_URL, backend=config.CELERY_RESULT_BACKEND
    )
    sender.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
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
    )
    return sender
