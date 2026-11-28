"""Process-owned configuration and database resources."""

from app.composition.media_resources import ResourceServices
from app.platform.config.resources import ResourcePolicies
from app.platform.config.storage import ObjectStorageConfig
from app.storage.s3_compatible import S3CompatibleObjectStorage
from app.storage.base import ObjectStorage
from app.composition.dispatch.services import DispatchServices, build_dispatch_services
from app.task_queue.publisher import build_publisher
from app.modules.revisions.post_commit import RevisionPostCommitCoordinator
from dataclasses import dataclass
from app.composition.delivery_services import DeliveryServices, build_delivery_services
from app.platform.config.delivery import DeliveryConfig
from functools import lru_cache
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from app.platform.db.engine import build_engine, build_session_factory
from app.runtime.worker.settings import WorkerSettings


@dataclass(frozen=True)
class RuntimeContext:
    settings: WorkerSettings
    engine: Engine
    sessions: sessionmaker[Session]
    dispatches: DispatchServices
    deliveries: DeliveryServices
    storage: ObjectStorage
    resources: ResourceServices


@lru_cache(maxsize=1)
def get_context() -> RuntimeContext:
    config = WorkerSettings()
    engine = build_engine(config)
    sessions = build_session_factory(engine)
    deliveries = build_delivery_services(DeliveryConfig.model_validate(config.model_dump()))
    dispatches = build_dispatch_services(sessions, deliveries, build_publisher(config))
    storage = S3CompatibleObjectStorage(ObjectStorageConfig.model_validate(config.model_dump()))
    post_commit = RevisionPostCommitCoordinator(
        dispatches.render.dispatch_score_revision_render,
        dispatches.playback.dispatch_playback_outbox,
        dispatches.metadata.dispatch_revision_metadata,
    )
    resources = ResourceServices(
        storage,
        sessions,
        ResourcePolicies.model_validate(config.model_dump()),
        post_commit,
        dispatches.score_deletion.dispatch_score_deletion_best_effort,
    )
    return RuntimeContext(config, engine, sessions, dispatches, deliveries, storage, resources)
