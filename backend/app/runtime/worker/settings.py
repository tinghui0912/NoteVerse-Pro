"""Scoped environment contract for this process."""

from pydantic import model_validator
from typing import Self

from pydantic_settings import BaseSettings, SettingsConfigDict
from app.runtime.config_blocks import (
    DatabaseConfig,
    TaskQueueConfig,
    ObjectStorageConfig,
    MailConfig,
    ObservabilityConfig,
)
from app.platform.config.service_identity import ServiceIdentitySettings
from app.platform.config.storage import WorkDirectoryConfig, MediaStoragePolicyConfig
from app.platform.config.account_deletion import AccountDeletionSettings
from app.platform.config.derived_asset_retention import DerivedAssetRetentionSettings
from app.platform.config.revision_metadata_delivery import RevisionMetadataDeliverySettings
from app.platform.config.object_writes import ObjectWriteSettings
from app.platform.config.import_dispatch import ImportDispatchSettings
from app.platform.config.mail_delivery import MailDeliverySettings
from app.platform.config.notification_lifecycle import NotificationLifecycleSettings
from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings
from app.platform.config.playback_delivery import PlaybackDeliverySettings
from app.platform.config.realtime_retention import RealtimeRetentionSettings
from app.platform.config.revision_render_delivery import RevisionRenderDeliverySettings
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings
from app.platform.config.beat_scheduler import BeatSchedulerSettings
from app.platform.config.task_reliability import TaskReliabilitySettings
from app.platform.config.worker_model_engine import WorkerModelEngineSettings
from app.platform.config.playback import PlaybackSettings


class WorkerSettings(
    DatabaseConfig,
    TaskQueueConfig,
    ObjectStorageConfig,
    MailConfig,
    ObservabilityConfig,
    ServiceIdentitySettings,
    WorkDirectoryConfig,
    MediaStoragePolicyConfig,
    AccountDeletionSettings,
    DerivedAssetRetentionSettings,
    RevisionMetadataDeliverySettings,
    ObjectWriteSettings,
    ImportDispatchSettings,
    MailDeliverySettings,
    NotificationLifecycleSettings,
    StoredObjectRetirementSettings,
    PlaybackDeliverySettings,
    RealtimeRetentionSettings,
    RevisionRenderDeliverySettings,
    ScoreDeletionDeliverySettings,
    BeatSchedulerSettings,
    TaskReliabilitySettings,
    WorkerModelEngineSettings,
    PlaybackSettings,
    BaseSettings,
):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", frozen=False)

    @model_validator(mode="after")
    def validate_processing_envelope(self) -> Self:
        if self.PADDLEOCR_TIMEOUT_SECONDS > self.MAX_PROCESSING_TIME:
            raise ValueError("PADDLEOCR_TIMEOUT_SECONDS must not exceed MAX_PROCESSING_TIME")
        return self
