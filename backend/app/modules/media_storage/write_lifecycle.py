"""Durable cleanup delivery policy for unadopted write generations."""

from app.platform.config.object_writes import ObjectWriteSettings

from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.modules.durable_work.delivery import (
    DurableDeliveryLifecycle,
    DeliveryTransitions,
    DeliveryStatuses,
    DeliveryLifecyclePolicy,
)


def cleanup_lifecycle(
    *, config: ObjectWriteSettings
) -> DurableDeliveryLifecycle[ObjectWriteIntentStatus]:
    return DurableDeliveryLifecycle(
        DeliveryStatuses(
            ObjectWriteIntentStatus.CLEANUP_PENDING,
            ObjectWriteIntentStatus.CLEANUP_DISPATCHED,
            ObjectWriteIntentStatus.CLEANUP_PROCESSING,
            ObjectWriteIntentStatus.CLEANUP_FAILED,
            ObjectWriteIntentStatus.CLEANED,
        ),
        DeliveryLifecyclePolicy(
            config.OBJECT_WRITE_CLEANUP_MAX_ATTEMPTS,
            config.OBJECT_WRITE_CLEANUP_RETRY_BASE_SECONDS,
            config.OBJECT_WRITE_CLEANUP_DISPATCH_TIMEOUT_SECONDS,
            config.OBJECT_WRITE_CLEANUP_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


def cleanup_transitions() -> DeliveryTransitions[ObjectWriteIntentStatus]:
    return DeliveryTransitions(
        DeliveryStatuses(
            ObjectWriteIntentStatus.CLEANUP_PENDING,
            ObjectWriteIntentStatus.CLEANUP_DISPATCHED,
            ObjectWriteIntentStatus.CLEANUP_PROCESSING,
            ObjectWriteIntentStatus.CLEANUP_FAILED,
            ObjectWriteIntentStatus.CLEANED,
        )
    )
