"""Application settings and configuration validation."""

import json
from functools import lru_cache
from ipaddress import ip_network
from pathlib import Path
from typing import List, Optional

from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.settings.observability import ObservabilitySettings
from app.core.settings.async_database import AsyncDatabaseSettings
from app.core.settings.beat_scheduler import BeatSchedulerSettings
from app.core.settings.playback import PlaybackSettings
from app.core.settings.queue import QueueSettings
from app.core.settings.practice_diagnostics import PracticeDiagnosticsSettings
from app.core.settings.storage import StorageSettings
from app.core.settings.worker_database import WorkerDatabaseSettings
from app.core.settings.worker_model_engine import WorkerModelEngineSettings


BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(AsyncDatabaseSettings, BeatSchedulerSettings, ObservabilitySettings, PlaybackSettings, QueueSettings, StorageSettings, WorkerDatabaseSettings, BaseSettings):
    PROJECT_NAME: str = "NoteVerse Pro"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    AUTH_COOKIE_NAME: str
    REFRESH_COOKIE_NAME: str
    CSRF_COOKIE_NAME: str
    CSRF_HEADER_NAME: str
    AUTH_COOKIE_SECURE: bool
    AUTH_COOKIE_SAMESITE: str
    CONTROL_PLANE_AUTH_COOKIE_NAME: Optional[str] = None
    CONTROL_PLANE_CSRF_COOKIE_NAME: Optional[str] = None
    CONTROL_PLANE_CSRF_HEADER_NAME: Optional[str] = None
    CONTROL_PLANE_COOKIE_SECURE: Optional[bool] = None
    CONTROL_PLANE_COOKIE_SAMESITE: Optional[str] = None
    CONTROL_PLANE_SESSION_EXPIRE_MINUTES: Optional[int] = None
    CONTROL_PLANE_CORS_ORIGINS: Optional[List[AnyHttpUrl]] = None
    DEBUG: bool = False
    FRONTEND_BASE_URL: str
    REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS: int = 2
    REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS: int = 15
    REALTIME_EVENT_BATCH_SIZE: int = 100
    REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS: int
    REALTIME_EVENT_RETENTION_DAYS: int
    # CORS
    BACKEND_CORS_ORIGINS: List[AnyHttpUrl]
    TRUSTED_PROXY_CIDRS: List[str]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    def assemble_cors_origins(cls, v: str | List[str]) -> List[str]:
        if v in (None, ""):
            return []
        if isinstance(v, list):
            return v
        raise ValueError("BACKEND_CORS_ORIGINS must be a JSON array")

    @field_validator("CONTROL_PLANE_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_control_plane_cors_origins(cls, value: str | List[str] | None) -> List[str] | None:
        if value is None or value == "":
            return None
        if isinstance(value, list):
            return value
        raise ValueError("CONTROL_PLANE_CORS_ORIGINS must be a JSON array")

    @field_validator("TRUSTED_PROXY_CIDRS", mode="before")
    @classmethod
    def parse_trusted_proxy_cidrs(cls, value: str | List[str]) -> List[str]:
        """Require an explicit, valid CIDR allowlist for forwarding headers."""

        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("TRUSTED_PROXY_CIDRS must be a JSON array") from exc
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError("TRUSTED_PROXY_CIDRS must be a JSON array")
        try:
            networks = [ip_network(item, strict=False) for item in value]
        except ValueError as exc:
            raise ValueError("TRUSTED_PROXY_CIDRS must contain valid IP networks") from exc
        if any(network.prefixlen == 0 for network in networks):
            raise ValueError("TRUSTED_PROXY_CIDRS must not trust every address")
        return [str(network) for network in networks]

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_flag(cls, v):
        """Allow environment-style debug labels in addition to booleans."""

        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            value = v.strip().lower()
            if value in {"1", "true", "yes", "on", "debug", "development", "dev"}:
                return True
            if value in {"0", "false", "no", "off", "release", "production", "prod"}:
                return False
        return v

    @field_validator(
        "IMPORT_DISPATCH_INTERVAL_SECONDS",
        "IMPORT_DISPATCH_TIMEOUT_SECONDS",
        "IMPORT_PROCESSING_TIMEOUT_SECONDS",
        "IMPORT_DISPATCH_MAX_ATTEMPTS",
        "IMPORT_DISPATCH_BATCH_SIZE",
        "NOTIFICATION_CLEANUP_INTERVAL_SECONDS",
        "NOTIFICATION_RETENTION_DAYS",
        "ORPHAN_UPLOAD_TTL_SECONDS",
        "RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_RETRY_BASE_SECONDS",
        "RENDER_OUTBOX_MAX_ATTEMPTS",
        "RENDER_OUTBOX_DISPATCH_BATCH_SIZE",
        "PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_RETRY_BASE_SECONDS",
        "PLAYBACK_OUTBOX_MAX_ATTEMPTS",
        "PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE",
        "REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS",
        "REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS",
        "REALTIME_EVENT_BATCH_SIZE",
        "REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS",
        "REALTIME_EVENT_RETENTION_DAYS",
        "MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_RETRY_BASE_SECONDS",
        "MAIL_OUTBOX_MAX_ATTEMPTS",
        "MAIL_OUTBOX_DISPATCH_BATCH_SIZE",
        "MAIL_OUTBOX_RETENTION_DAYS",
        "DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS",
        "SCORE_DELETION_CLEANUP_INTERVAL_SECONDS",
        "SCORE_DELETION_CLEANUP_BATCH_SIZE",
        "SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS",
        "SCORE_DELETION_CLEANUP_MAX_ATTEMPTS",
        "MAX_PROCESSING_TIME",
        "CELERY_TASK_SOFT_TIME_LIMIT",
        "CELERY_TASK_TIME_LIMIT",
        "SCHEDULER_LOCK_CONNECT_TIMEOUT_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_IDLE_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_INTERVAL_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_COUNT",
        "SCHEDULER_LOCK_STATEMENT_TIMEOUT_MILLISECONDS",
        "SCHEDULER_LOCK_TCP_USER_TIMEOUT_MILLISECONDS",
        "SCHEDULER_LEADER_RETRY_INTERVAL_SECONDS",
        "SCHEDULER_LEADER_HEARTBEAT_INTERVAL_SECONDS",
        "FINGERING_MAX_CONCURRENCY",
        "FINGERING_QUEUE_WAIT_SECONDS",
        "FINGERING_MAX_CONTENT_BYTES",
    )
    @classmethod
    def validate_positive_reliability_setting(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("task timing settings must be positive integers")
        return v

    @field_validator("DERIVED_ASSET_RETAIN_RECENT_REVISIONS")
    @classmethod
    def validate_derived_asset_retention_count(cls, v: int) -> int:
        if v < 0:
            raise ValueError("DERIVED_ASSET_RETAIN_RECENT_REVISIONS must be non-negative")
        return v

    # Database

    FINGERING_MAX_CONCURRENCY: int = 2
    FINGERING_QUEUE_WAIT_SECONDS: int = 5
    FINGERING_MAX_CONTENT_BYTES: int = 2 * 1024 * 1024
    IMPORT_DISPATCH_INTERVAL_SECONDS: int = 30
    IMPORT_DISPATCH_TIMEOUT_SECONDS: int = 300
    IMPORT_PROCESSING_TIMEOUT_SECONDS: int = 1200
    IMPORT_DISPATCH_MAX_ATTEMPTS: int = 3
    IMPORT_DISPATCH_BATCH_SIZE: int = 20
    NOTIFICATION_CLEANUP_INTERVAL_SECONDS: int = 86400
    NOTIFICATION_RETENTION_DAYS: int = 90
    ORPHAN_UPLOAD_TTL_SECONDS: int = 86400
    RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 1200
    RENDER_OUTBOX_RETRY_BASE_SECONDS: int = 60
    RENDER_OUTBOX_MAX_ATTEMPTS: int = 5
    RENDER_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 30
    PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 300
    PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 1200
    PLAYBACK_OUTBOX_RETRY_BASE_SECONDS: int = 60
    PLAYBACK_OUTBOX_MAX_ATTEMPTS: int = 5
    PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 10
    MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 120
    MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 120
    MAIL_OUTBOX_RETRY_BASE_SECONDS: int = 30
    MAIL_OUTBOX_MAX_ATTEMPTS: int = 5
    MAIL_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    MAIL_OUTBOX_RETENTION_DAYS: int = 7
    DERIVED_ASSET_RETAIN_RECENT_REVISIONS: int = 10
    DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS: int = 86400
    SCORE_DELETION_CLEANUP_INTERVAL_SECONDS: int = 60
    SCORE_DELETION_CLEANUP_BATCH_SIZE: int = 20
    SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS: int = 60
    SCORE_DELETION_CLEANUP_MAX_ATTEMPTS: int = 10

    MAX_PROCESSING_TIME: int = 900
    CELERY_TASK_SOFT_TIME_LIMIT: int = 960
    CELERY_TASK_TIME_LIMIT: int = 1020
    ALLOWED_EXTENSIONS: set = {
        "png",
        "jpg",
        "jpeg",
        "bmp",
        "gif",
        "webp",
        "tiff",
        "tif",
    }

    # Email
    MAIL_DEFAULT_SENDER: Optional[str] = None
    RESEND_API_KEY: Optional[str] = None
    RESEND_API_URL: str = "https://api.resend.com/emails"

    # Auth email links
    EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS: int = 300
    EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS: int = 900

    @model_validator(mode="after")
    def validate_task_time_limits(self) -> "Settings":
        """Keep component timeouts inside the task shutdown envelope."""

        if self.MAX_PROCESSING_TIME >= self.CELERY_TASK_SOFT_TIME_LIMIT:
            raise ValueError(
                "MAX_PROCESSING_TIME must be lower than CELERY_TASK_SOFT_TIME_LIMIT"
            )
        if self.CELERY_TASK_SOFT_TIME_LIMIT >= self.CELERY_TASK_TIME_LIMIT:
            raise ValueError(
                "CELERY_TASK_SOFT_TIME_LIMIT must be lower than CELERY_TASK_TIME_LIMIT"
            )
        return self

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """Require a sufficiently strong secret key."""

        if len(v) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters long for security"
            )
        return v

    model_config = SettingsConfigDict(
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()


class WorkerRuntimeSettings(WorkerModelEngineSettings, BaseSettings):
    """Strict Worker-only model and engine environment contract."""

    MAX_PROCESSING_TIME: int = 900
    CELERY_TASK_SOFT_TIME_LIMIT: int = 960
    CELERY_TASK_TIME_LIMIT: int = 1020

    @model_validator(mode="after")
    def validate_task_time_limits(self) -> "WorkerRuntimeSettings":
        if self.PADDLEOCR_TIMEOUT_SECONDS > self.MAX_PROCESSING_TIME:
            raise ValueError("PADDLEOCR_TIMEOUT_SECONDS must not exceed MAX_PROCESSING_TIME")
        if self.MAX_PROCESSING_TIME >= self.CELERY_TASK_SOFT_TIME_LIMIT:
            raise ValueError("MAX_PROCESSING_TIME must be lower than CELERY_TASK_SOFT_TIME_LIMIT")
        if self.CELERY_TASK_SOFT_TIME_LIMIT >= self.CELERY_TASK_TIME_LIMIT:
            raise ValueError("CELERY_TASK_SOFT_TIME_LIMIT must be lower than CELERY_TASK_TIME_LIMIT")
        return self

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


@lru_cache
def get_worker_runtime_settings() -> WorkerRuntimeSettings:
    """Load model/engine configuration only in Worker-owned execution paths."""

    return WorkerRuntimeSettings()


class PracticeRuntimeSettings(PracticeDiagnosticsSettings, BaseSettings):
    """Strict Practice-only audio alignment environment contract."""

    PRACTICE_SOUNDFONT_PATH: str

    @field_validator("PRACTICE_SOUNDFONT_PATH")
    @classmethod
    def normalize_soundfont_path(cls, value: str) -> str:
        return str(Path(value).expanduser())

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


@lru_cache
def get_practice_runtime_settings() -> PracticeRuntimeSettings:
    """Load Practice alignment configuration only in Practice-owned paths."""

    return PracticeRuntimeSettings()
