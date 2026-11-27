"""Resource command composition without HTTP identity or broker configuration."""

from functools import lru_cache
from dataclasses import dataclass
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from app.platform.db.engine import build_engine, build_session_factory
from app.platform.config.storage import ObjectStorageConfig
from app.platform.config.resources import ResourcePolicies
from app.modules.revisions.post_commit import RevisionPostCommitCoordinator
from app.composition.media_resources import ResourceServices
from app.storage.s3_compatible import S3CompatibleObjectStorage
from app.runtime.cli.settings import ResourceCommandSettings


@dataclass(frozen=True)
class ResourceCommandContext:
    engine: Engine
    sessions: sessionmaker[Session]
    resources: ResourceServices


def deferred_dispatch(operation_id: str) -> bool:
    """Scheduled scans publish persisted delivery records."""
    return False


@lru_cache(maxsize=1)
def get_context() -> ResourceCommandContext:
    config = ResourceCommandSettings()
    engine = build_engine(config)
    sessions = build_session_factory(engine)
    storage = S3CompatibleObjectStorage(ObjectStorageConfig.model_validate(config.model_dump()))
    callbacks = RevisionPostCommitCoordinator(
        deferred_dispatch, deferred_dispatch, deferred_dispatch
    )
    resources = ResourceServices(
        storage,
        sessions,
        ResourcePolicies.model_validate(config.model_dump()),
        callbacks,
        lambda identity: None,
    )
    return ResourceCommandContext(engine, sessions, resources)
