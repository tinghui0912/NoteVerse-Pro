"""Redis and Celery transport configuration shared across backend roles."""

from pydantic import BaseModel


class QueueSettings(BaseModel):
    REDIS_URL: str
    CELERY_BROKER_URL: str
    CELERY_RESULT_BACKEND: str
