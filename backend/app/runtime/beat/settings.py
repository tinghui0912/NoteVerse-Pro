"""Beat loads scheduling, transport and advisory-lock inputs only."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from app.runtime.config_blocks import DatabaseConfig, TaskQueueConfig, ObservabilityConfig
from app.platform.config.service_identity import ServiceIdentitySettings
from app.platform.config.storage import WorkDirectoryConfig
from app.platform.config.queue_schedule import QueueScheduleConfig
from app.platform.config.beat_scheduler import BeatSchedulerSettings
from app.platform.config.task_reliability import TaskReliabilitySettings


class BeatSettings(
    DatabaseConfig,
    TaskQueueConfig,
    ObservabilityConfig,
    ServiceIdentitySettings,
    WorkDirectoryConfig,
    QueueScheduleConfig,
    BeatSchedulerSettings,
    TaskReliabilitySettings,
    BaseSettings,
):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", frozen=False)
