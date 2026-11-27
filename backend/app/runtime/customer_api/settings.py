"""Scoped environment contract for this process."""

from typing import Literal
from pydantic import model_validator
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
from app.platform.config.public_frontend_url import PublicFrontendUrlSettings
from app.platform.config.fingering_execution import FingeringExecutionSettings
from app.platform.config.model_asset_delivery import ModelAssetDeliverySettings
from app.platform.config.realtime_stream import RealtimeStreamSettings
from app.platform.config.trusted_proxy import TrustedProxySettings
from app.platform.config.browser_abuse import CustomerRateLimitSettings


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
    PublicFrontendUrlSettings,
    FingeringExecutionSettings,
    ModelAssetDeliverySettings,
    RealtimeStreamSettings,
    TrustedProxySettings,
    CustomerRateLimitSettings,
    BaseSettings,
):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", frozen=False)

    ENVIRONMENT: Literal["development", "test", "staging", "production"] = "development"

    @model_validator(mode="after")
    def validate_cookie_transport(self):
        if self.ENVIRONMENT in {"staging", "production"} and not self.AUTH_COOKIE_SECURE:
            raise ValueError("Secure session cookies are required in staging and production")
        if self.ENVIRONMENT in {"staging", "production"} and not self.BACKEND_CORS_ORIGINS:
            raise ValueError("Explicit browser origins are required in production")
        if self.TRUSTED_PROXY_HOPS and not self.TRUSTED_PROXY_CIDRS:
            raise ValueError("Trusted proxy hops require an explicit peer allowlist")
        return self
