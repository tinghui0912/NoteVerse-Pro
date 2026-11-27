"""Process-owned configuration and database resources."""

from app.modules.auth.sessions_service import SessionService
from app.modules.auth.session_cache import SessionCache
from app.platform.config.application import CustomerAuthConfig
from redis import Redis
from redis.retry import Retry
from redis.backoff import NoBackoff


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
    sessions_service: SessionService


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
    session_cache = SessionCache(
        Redis.from_url(
            config.REDIS_URL,
            socket_timeout=0.2,
            socket_connect_timeout=0.2,
            retry=Retry(NoBackoff(), 0),
        ),
        ttl_seconds=config.SESSION_CACHE_TTL_SECONDS,
    )
    sessions_service = SessionService(
        config=CustomerAuthConfig.model_validate(config.model_dump()),
        cache=session_cache,
        sessions=sessions,
    )
    return RuntimeContext(
        config, engine, sessions, dispatches, deliveries, storage, resources, sessions_service
    )
