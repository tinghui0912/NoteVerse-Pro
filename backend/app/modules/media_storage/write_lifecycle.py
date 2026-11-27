"""Durable cleanup delivery policy for unadopted write generations."""

from app.core.config import settings
from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.modules.durable_work.delivery import (
    DurableDeliveryLifecycle,
    DeliveryStatuses,
    DeliveryLifecyclePolicy,
)


def cleanup_lifecycle() -> DurableDeliveryLifecycle[ObjectWriteIntentStatus]:
    return DurableDeliveryLifecycle(
        DeliveryStatuses(
            ObjectWriteIntentStatus.CLEANUP_PENDING,
            ObjectWriteIntentStatus.CLEANUP_DISPATCHED,
            ObjectWriteIntentStatus.CLEANUP_PROCESSING,
            ObjectWriteIntentStatus.CLEANUP_FAILED,
            ObjectWriteIntentStatus.CLEANED,
        ),
        DeliveryLifecyclePolicy(
            settings.OBJECT_WRITE_CLEANUP_MAX_ATTEMPTS,
            settings.OBJECT_WRITE_CLEANUP_RETRY_BASE_SECONDS,
            settings.OBJECT_WRITE_CLEANUP_DISPATCH_TIMEOUT_SECONDS,
            settings.OBJECT_WRITE_CLEANUP_PROCESSING_TIMEOUT_SECONDS,
        ),
    )
