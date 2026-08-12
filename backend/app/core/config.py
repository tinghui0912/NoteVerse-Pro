"""Application settings and configuration validation."""

from pathlib import Path
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
from app.core.settings.playback_delivery import PlaybackDeliverySettings
from app.core.settings.public_frontend_url import PublicFrontendUrlSettings
from app.core.settings.queue import QueueSettings
from app.core.settings.render_asset_delivery import RenderAssetDeliverySettings
from app.core.settings.realtime_retention import RealtimeRetentionSettings
from app.core.settings.realtime_stream import RealtimeStreamSettings
from app.core.settings.score_deletion_lifecycle import ScoreDeletionLifecycleSettings
from app.core.settings.service_identity import ServiceIdentitySettings
from app.core.settings.storage import StorageSettings
from app.core.settings.token_signing import TokenSigningSettings
from app.core.settings.transactional_mail_provider import TransactionalMailProviderSettings
from app.core.settings.trusted_proxy import TrustedProxySettings
from app.core.settings.upload_admission import UploadAdmissionSettings
from app.core.settings.sync_database import SyncDatabaseSettings


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
    PublicFrontendUrlSettings,
    QueueSettings,
    RealtimeRetentionSettings,
    RealtimeStreamSettings,
    RenderAssetDeliverySettings,
    ScoreDeletionLifecycleSettings,
    ServiceIdentitySettings,
    StorageSettings,
    TokenSigningSettings,
    TransactionalMailProviderSettings,
    TrustedProxySettings,
    UploadAdmissionSettings,
    SyncDatabaseSettings,
    BaseSettings,
):
    model_config = SettingsConfigDict(
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
