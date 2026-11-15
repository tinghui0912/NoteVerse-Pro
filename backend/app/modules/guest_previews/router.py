from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.api.storage_streaming import stream_storage_object
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.guest_previews.dependencies import get_guest_preview_service
from app.modules.guest_previews.schemas import (
    GuestPreviewUpdateRequest,
    GuestPreviewSettingsRead,
    GuestPreviewRead,
)
from app.modules.guest_previews.service import GuestPreviewService


score_router = APIRouter()
preview_router = APIRouter()


@score_router.get(
    "/{score_id}/guest-preview",
    operation_id="scoreGuestPreviewSettingsGet",
    response_model=GuestPreviewSettingsRead,
)
def read_guest_preview_settings(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return service.settings(db, score_id, require_persisted_id(current_user.id, entity="user"))


@score_router.patch(
    "/{score_id}/guest-preview",
    operation_id="scoreGuestPreviewSettingsUpdate",
    response_model=GuestPreviewSettingsRead,
)
def update_guest_preview_settings(
    score_id: str,
    request: GuestPreviewUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return service.update_settings(
        db, score_id, require_persisted_id(current_user.id, entity="user"), request
    )


@preview_router.get("/{token}", operation_id="guestPreviewGet", response_model=GuestPreviewRead)
def read_guest_preview(
    token: str,
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return service.read(db, token)


@preview_router.get(
    "/{token}/render-assets/{asset_id}/view",
    response_class=Response,
    responses=binary_responses("image/*"),
    operation_id="guestPreviewPageView",
)
def view_guest_preview_page(
    token: str,
    asset_id: str,
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    delivery = service.image(db, token, asset_id)
    response = stream_storage_object(
        storage=service.storage,
        target=delivery,
        attachment=False,
    )
    return response


@preview_router.get(
    "/{token}/playback",
    response_class=Response,
    responses=binary_responses("audio/*", byte_ranges=True),
    operation_id="guestPreviewPlaybackStream",
)
def listen_guest_preview(
    token: str,
    request: Request,
    db: Session = Depends(get_db, scope="function"),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    delivery = service.audio(db, token)
    response = stream_storage_object(
        storage=service.storage,
        target=delivery,
        attachment=False,
        request=request,
        enable_range=True,
    )
    return response
