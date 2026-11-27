from pydantic import SecretStr
from app.platform.config.revision_metadata_delivery import RevisionMetadataDeliverySettings
from app.platform.config.worker_model_engine import WorkerModelEngineSettings
from app.platform.config.playback import PlaybackSettings
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.runtime.config_blocks import DatabaseConfig, ObjectStorageConfig
from app.platform.config.resources import ResourcePolicies


class DatabaseCommandSettings(DatabaseConfig, BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


class ResourceCommandSettings(DatabaseConfig, ObjectStorageConfig, ResourcePolicies, BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


class MetadataCommandSettings(DatabaseConfig, RevisionMetadataDeliverySettings, BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")


class AssetCommandSettings(WorkerModelEngineSettings, PlaybackSettings, BaseSettings):
    HF_TOKEN: SecretStr | None = None
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")
