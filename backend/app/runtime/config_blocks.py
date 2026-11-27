"""Pure configuration blocks composed by process-specific settings loaders."""

from pydantic import ConfigDict, BaseModel
from app.platform.config.database import DatabaseSettings
from app.platform.config.queue import QueueSettings
from app.platform.config.storage import ObjectStorageConfig as StorageConnectionConfig
from app.platform.config.transactional_mail_provider import TransactionalMailProviderSettings
from app.platform.config.observability import ObservabilitySettings


class DatabaseConfig(DatabaseSettings):
    model_config = ConfigDict(frozen=True)


class RedisConfig(BaseModel):
    REDIS_URL: str


class TaskQueueConfig(QueueSettings):
    model_config = ConfigDict(frozen=True)


class ObjectStorageConfig(StorageConnectionConfig):
    model_config = ConfigDict(frozen=True)


class MailConfig(TransactionalMailProviderSettings):
    model_config = ConfigDict(frozen=True)


class ObservabilityConfig(ObservabilitySettings):
    model_config = ConfigDict(frozen=True)
