"""Application settings and configuration validation."""

from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.settings.observability import ObservabilitySettings
from app.core.settings.async_database import AsyncDatabaseSettings
from app.core.settings.account_email_link import AccountEmailLinkSettings
from app.core.settings.beat_scheduler import BeatSchedulerSettings
from app.core.settings.browser_cors import BrowserCorsSettings
from app.core.settings.customer_session_security import CustomerSessionSecuritySettings
from app.core.settings.fingering_execution import FingeringExecutionSettings
from app.core.settings.import_dispatch import ImportDispatchSettings
from app.core.settings.mail_delivery import MailDeliverySettings
from app.core.settings.notification_lifecycle import NotificationLifecycleSettings
from app.core.settings.playback import PlaybackSettings
from app.core.settings.playback_delivery import PlaybackDeliverySettings
from app.core.settings.public_frontend_url import PublicFrontendUrlSettings
from app.core.settings.queue import QueueSettings
from app.core.settings.practice_diagnostics import PracticeDiagnosticsSettings
from app.core.settings.render_asset_delivery import RenderAssetDeliverySettings
from app.core.settings.realtime_retention import RealtimeRetentionSettings
from app.core.settings.realtime_stream import RealtimeStreamSettings
from app.core.settings.score_deletion_lifecycle import ScoreDeletionLifecycleSettings
from app.core.settings.service_identity import ServiceIdentitySettings
from app.core.settings.storage import StorageSettings
from app.core.settings.task_reliability import TaskReliabilitySettings
from app.core.settings.token_signing import TokenSigningSettings
from app.core.settings.transactional_mail_provider import TransactionalMailProviderSettings
from app.core.settings.trusted_proxy import TrustedProxySettings
from app.core.settings.upload_admission import UploadAdmissionSettings
from app.core.settings.worker_database import WorkerDatabaseSettings
from app.core.settings.worker_model_engine import WorkerModelEngineSettings


BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(
    AccountEmailLinkSettings,
    AsyncDatabaseSettings,
    BeatSchedulerSettings,
    BrowserCorsSettings,
    CustomerSessionSecuritySettings,
    FingeringExecutionSettings,
    ImportDispatchSettings,
    MailDeliverySettings,
    NotificationLifecycleSettings,
    ObservabilitySettings,
    PlaybackDeliverySettings,
    PlaybackSettings,
    PublicFrontendUrlSettings,
    QueueSettings,
    RealtimeRetentionSettings,
    RealtimeStreamSettings,
    RenderAssetDeliverySettings,
    ScoreDeletionLifecycleSettings,
    ServiceIdentitySettings,
    StorageSettings,
    TaskReliabilitySettings,
    TokenSigningSettings,
    TransactionalMailProviderSettings,
    TrustedProxySettings,
    UploadAdmissionSettings,
    WorkerDatabaseSettings,
    BaseSettings,
):
    CONTROL_PLANE_AUTH_COOKIE_NAME: Optional[str] = None
    CONTROL_PLANE_CSRF_COOKIE_NAME: Optional[str] = None
    CONTROL_PLANE_CSRF_HEADER_NAME: Optional[str] = None
    CONTROL_PLANE_COOKIE_SECURE: Optional[bool] = None
    CONTROL_PLANE_COOKIE_SAMESITE: Optional[str] = None
    CONTROL_PLANE_SESSION_EXPIRE_MINUTES: Optional[int] = None
    CONTROL_PLANE_CORS_ORIGINS: Optional[List[AnyHttpUrl]] = None

    @field_validator("CONTROL_PLANE_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_control_plane_cors_origins(cls, value: str | List[str] | None) -> List[str] | None:
        if value is None or value == "":
            return None
        if isinstance(value, list):
            return value
        raise ValueError("CONTROL_PLANE_CORS_ORIGINS must be a JSON array")

    @field_validator(
        "SCHEDULER_LOCK_CONNECT_TIMEOUT_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_IDLE_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_INTERVAL_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_COUNT",
        "SCHEDULER_LOCK_STATEMENT_TIMEOUT_MILLISECONDS",
        "SCHEDULER_LOCK_TCP_USER_TIMEOUT_MILLISECONDS",
        "SCHEDULER_LEADER_RETRY_INTERVAL_SECONDS",
        "SCHEDULER_LEADER_HEARTBEAT_INTERVAL_SECONDS",
    )
    @classmethod
    def validate_positive_reliability_setting(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("task timing settings must be positive integers")
        return v

    # Database

    model_config = SettingsConfigDict(
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()


class WorkerRuntimeSettings(WorkerModelEngineSettings, TaskReliabilitySettings, BaseSettings):
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
