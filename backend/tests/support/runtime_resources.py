"""Explicit in-memory resource composition for business lifecycle tests."""

from app.runtime.worker.context import get_context as worker_context

from functools import lru_cache
from app.composition.media_resources import ResourceServices
from app.composition.delivery_services import build_delivery_services
from app.platform.config.resources import ResourcePolicies
from app.platform.config.delivery import DeliveryConfig
from app.modules.revisions.post_commit import RevisionPostCommitCoordinator
from app.runtime.customer_api.context import get_context
from tests.support.object_storage import InMemoryObjectStorage

storage = InMemoryObjectStorage()


def ignore_dispatch(identity: str) -> None:
    pass


def resources_for(provider=None, sessions=None) -> ResourceServices:
    context = get_context()
    callbacks = RevisionPostCommitCoordinator(ignore_dispatch, ignore_dispatch, ignore_dispatch)
    return ResourceServices(
        provider if provider is not None else storage,
        sessions or context.resources.sessions,
        ResourcePolicies.model_validate(context.settings.model_dump()),
        callbacks,
        ignore_dispatch,
    )


@lru_cache(maxsize=1)
def deliveries():
    config = DeliveryConfig.model_validate(worker_context().settings.model_dump())
    return build_delivery_services(config)
