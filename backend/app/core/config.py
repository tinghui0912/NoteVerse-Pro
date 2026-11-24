"""Application settings and configuration validation."""

from pathlib import Path
from app.core.settings.derived_asset_retention import DerivedAssetRetentionSettings
from app.core.settings.revision_metadata_delivery import RevisionMetadataDeliverySettings
from app.core.settings.object_writes import ObjectWriteSettings
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.settings.account_deletion import AccountDeletionSettings
from app.core.settings.observability import ObservabilitySettings
from app.core.settings.database import DatabaseSettings
from app.core.settings.account_email_link import AccountEmailLinkSettings
from app.core.settings.beat_scheduler import BeatSchedulerSettings
from app.core.settings.browser_cors import BrowserCorsSettings
from app.core.settings.customer_session_security import CustomerSessionSecuritySettings
from app.core.settings.fingering_execution import FingeringExecutionSettings
from app.core.settings.import_dispatch import ImportDispatchSettings
from app.core.settings.mail_delivery import MailDeliverySettings
from app.core.settings.model_asset_delivery import ModelAssetDeliverySettings
from app.core.settings.notification_lifecycle import NotificationLifecycleSettings
from app.core.settings.stored_object_retirement import StoredObjectRetirementSettings
from app.core.settings.playback_delivery import PlaybackDeliverySettings
from app.core.settings.public_frontend_url import PublicFrontendUrlSettings
from app.core.settings.queue import QueueSettings
from app.core.settings.revision_render_delivery import RevisionRenderDeliverySettings
from app.core.settings.realtime_retention import RealtimeRetentionSettings
from app.core.settings.realtime_stream import RealtimeStreamSettings
from app.core.settings.score_deletion_delivery import ScoreDeletionDeliverySettings
from app.core.settings.service_identity import ServiceIdentitySettings
from app.core.settings.storage import StorageSettings
from app.core.settings.token_signing import TokenSigningSettings
from app.core.settings.transactional_mail_provider import TransactionalMailProviderSettings
from app.core.settings.trusted_proxy import TrustedProxySettings


BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(
    AccountDeletionSettings,
    DerivedAssetRetentionSettings,
    RevisionMetadataDeliverySettings,
    ObjectWriteSettings,
    AccountEmailLinkSettings,
    DatabaseSettings,
    BeatSchedulerSettings,
    BrowserCorsSettings,
    CustomerSessionSecuritySettings,
    FingeringExecutionSettings,
    ImportDispatchSettings,
    MailDeliverySettings,
    ModelAssetDeliverySettings,
    NotificationLifecycleSettings,
    ObservabilitySettings,
    StoredObjectRetirementSettings,
    PlaybackDeliverySettings,
    PublicFrontendUrlSettings,
    QueueSettings,
    RealtimeRetentionSettings,
    RealtimeStreamSettings,
    RevisionRenderDeliverySettings,
    ScoreDeletionDeliverySettings,
    ServiceIdentitySettings,
    StorageSettings,
    TokenSigningSettings,
    TransactionalMailProviderSettings,
    TrustedProxySettings,
    BaseSettings,
):
    model_config = SettingsConfigDict(
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
