"""Strict Worker runtime settings projection."""

from __future__ import annotations

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .playback import PlaybackSettings
from .practice_replay_deletion import PracticeReplayDeletionSettings
from .task_reliability import TaskReliabilitySettings
from .worker_model_engine import WorkerModelEngineSettings


class WorkerRuntimeSettings(
    PlaybackSettings,
    PracticeReplayDeletionSettings,
    WorkerModelEngineSettings,
    TaskReliabilitySettings,
    BaseSettings,
):
    """Strict Worker-only model and engine environment contract."""

    @model_validator(mode="after")
    def validate_worker_task_time_limits(self) -> "WorkerRuntimeSettings":
        if self.PADDLEOCR_TIMEOUT_SECONDS > self.MAX_PROCESSING_TIME:
            raise ValueError("PADDLEOCR_TIMEOUT_SECONDS must not exceed MAX_PROCESSING_TIME")
        return self

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


@lru_cache
def get_worker_runtime_settings() -> WorkerRuntimeSettings:
    """Load model/engine configuration only in Worker-owned execution paths."""

    return WorkerRuntimeSettings()
