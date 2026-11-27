"""HTTP presentation of an authorized media-delivery decision."""

from fastapi.responses import Response, RedirectResponse
from app.api.storage_streaming import stream_storage_object
from app.modules.media_storage.delivery import MediaDeliveryService, DeliveryMode
from app.modules.media_storage.reads import StoredObjectDelivery


def deliver_media_object(
    *,
    service: MediaDeliveryService,
    target: StoredObjectDelivery,
    mode: DeliveryMode,
    attachment: bool,
) -> Response:
    decision = service.deliver(target, mode=mode, attachment=attachment)
    if decision.mode == DeliveryMode.SIGNED_REDIRECT:
        assert decision.location is not None
        return RedirectResponse(
            decision.location, headers={"Cache-Control": decision.cache_control}
        )
    response = stream_storage_object(storage=service.storage, target=target, attachment=attachment)
    response.headers["Cache-Control"] = decision.cache_control
    return response
