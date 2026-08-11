"""Task execution deadline and shutdown-envelope configuration."""

from functools import lru_cache
from typing import Self

from pydantic import BaseModel, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class TaskReliabilitySettings(BaseModel):
    MAX_PROCESSING_TIME: int = 900
    CELERY_TASK_SOFT_TIME_LIMIT: int = 960
    CELERY_TASK_TIME_LIMIT: int = 1020

    @field_validator(
        "MAX_PROCESSING_TIME",
        "CELERY_TASK_SOFT_TIME_LIMIT",
        "CELERY_TASK_TIME_LIMIT",
    )
    @classmethod
    def validate_positive_time_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("task timing settings must be positive integers")
        return value

    @model_validator(mode="after")
    def validate_task_time_limits(self) -> Self:
        if self.MAX_PROCESSING_TIME >= self.CELERY_TASK_SOFT_TIME_LIMIT:
            raise ValueError("MAX_PROCESSING_TIME must be lower than CELERY_TASK_SOFT_TIME_LIMIT")
        if self.CELERY_TASK_SOFT_TIME_LIMIT >= self.CELERY_TASK_TIME_LIMIT:
            raise ValueError("CELERY_TASK_SOFT_TIME_LIMIT must be lower than CELERY_TASK_TIME_LIMIT")
        return self


class TaskReliabilityRuntimeSettings(TaskReliabilitySettings, BaseSettings):
    """Strict Celery task deadline environment contract."""

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


@lru_cache
def get_task_reliability_settings() -> TaskReliabilityRuntimeSettings:
    """Load Celery task deadline configuration for Worker and Beat runtimes."""

    return TaskReliabilityRuntimeSettings()
