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
from app.composition.delivery_services import DispatchDeliveries, build_dispatch_deliveries
from app.platform.config.delivery import DispatchDeliveryConfig
from functools import lru_cache
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from app.platform.db.engine import build_engine, build_session_factory
from app.runtime.customer_api.settings import CustomerApiSettings


@dataclass(frozen=True)
class RuntimeContext:
    settings: CustomerApiSettings
    engine: Engine
    sessions: sessionmaker[Session]
    dispatches: DispatchServices
    deliveries: DispatchDeliveries
    storage: ObjectStorage
    resources: ResourceServices


@lru_cache(maxsize=1)
def get_context() -> RuntimeContext:
    config = CustomerApiSettings()
    engine = build_engine(config)
    sessions = build_session_factory(engine)
    deliveries = build_dispatch_deliveries(
        DispatchDeliveryConfig.model_validate(config.model_dump())
    )
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
