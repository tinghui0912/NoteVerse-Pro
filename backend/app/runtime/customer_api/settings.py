"""Scoped environment contract for this process."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from app.runtime.config_blocks import (
    DatabaseConfig,
    TaskQueueConfig,
    ObjectStorageConfig,
    ObservabilityConfig,
)
from app.platform.config.service_identity import ServiceIdentitySettings
from app.platform.config.storage import WorkDirectoryConfig, MediaStoragePolicyConfig
from app.platform.config.account_deletion import AccountDeletionSettings
from app.platform.config.revision_metadata_delivery import RevisionMetadataDeliverySettings
from app.platform.config.object_writes import ObjectWriteSettings
from app.platform.config.import_dispatch import ImportDispatchSettings
from app.platform.config.mail_delivery import MailDeliverySettings
from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings
from app.platform.config.playback_delivery import PlaybackDeliverySettings
from app.platform.config.revision_render_delivery import RevisionRenderDeliverySettings
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings
from app.platform.config.collaboration import CollaborationSettings
from app.platform.config.account_email_link import AccountEmailLinkSettings
from app.platform.config.browser_cors import BrowserCorsSettings
from app.platform.config.customer_session_security import CustomerSessionSecuritySettings
from app.platform.config.token_signing import TokenSigningSettings
from app.platform.config.public_frontend_url import PublicFrontendUrlSettings
from app.platform.config.fingering_execution import FingeringExecutionSettings
from app.platform.config.model_asset_delivery import ModelAssetDeliverySettings
from app.platform.config.realtime_stream import RealtimeStreamSettings
from app.platform.config.trusted_proxy import TrustedProxySettings


class CustomerApiSettings(
    DatabaseConfig,
    TaskQueueConfig,
    ObjectStorageConfig,
    ObservabilityConfig,
    ServiceIdentitySettings,
    WorkDirectoryConfig,
    MediaStoragePolicyConfig,
    AccountDeletionSettings,
    RevisionMetadataDeliverySettings,
    ObjectWriteSettings,
    ImportDispatchSettings,
    MailDeliverySettings,
    StoredObjectRetirementSettings,
    PlaybackDeliverySettings,
    RevisionRenderDeliverySettings,
    ScoreDeletionDeliverySettings,
    CollaborationSettings,
    AccountEmailLinkSettings,
    BrowserCorsSettings,
    CustomerSessionSecuritySettings,
    TokenSigningSettings,
    PublicFrontendUrlSettings,
    FingeringExecutionSettings,
    ModelAssetDeliverySettings,
    RealtimeStreamSettings,
    TrustedProxySettings,
    BaseSettings,
):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", frozen=False)
