from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.shared.responses import APIResponse, success_response


score_router = APIRouter()
preview_router = APIRouter()


@score_router.get(
    "/{score_id}/guest-preview",
    operation_id="scoreGuestPreviewSettingsGet",
    response_model=APIResponse[GuestPreviewSettingsRead],
)
async def read_guest_preview_settings(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return success_response(
        data=await service.settings(
            db, score_id, require_persisted_id(current_user.id, entity="user")
        )
    )


@score_router.patch(
    "/{score_id}/guest-preview",
    operation_id="scoreGuestPreviewSettingsUpdate",
    response_model=APIResponse[GuestPreviewSettingsRead],
)
async def update_guest_preview_settings(
    score_id: str,
    request: GuestPreviewUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return success_response(
        data=await service.update_settings(
            db, score_id, require_persisted_id(current_user.id, entity="user"), request
        )
    )


@preview_router.get(
    "/{token}", operation_id="guestPreviewGet", response_model=APIResponse[GuestPreviewRead]
)
async def read_guest_preview(
    token: str,
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return success_response(data=await service.read(db, token))


@preview_router.get(
    "/{token}/render-assets/{asset_id}/view",
    response_class=Response,
    responses=binary_responses("image/*"),
    operation_id="guestPreviewPageView",
)
async def view_guest_preview_page(
    token: str,
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    delivery = await service.image(db, token, asset_id)
    response = stream_storage_object(
        storage=service.storage,
        storage_key=delivery.storage_key,
        filename=delivery.filename,
        media_type=delivery.media_type,
        attachment=False,
    )
    return response


@preview_router.get(
    "/{token}/playback",
    response_class=Response,
    responses=binary_responses("audio/*", byte_ranges=True),
    operation_id="guestPreviewPlaybackStream",
)
async def listen_guest_preview(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    delivery = await service.audio(db, token)
    response = stream_storage_object(
        storage=service.storage,
        storage_key=delivery.storage_key,
        filename=delivery.filename,
        media_type=delivery.media_type,
        attachment=False,
        request=request,
        enable_range=True,
    )
    return response
