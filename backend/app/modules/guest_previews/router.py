from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.storage_streaming import stream_storage_object
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.guest_previews.dependencies import get_guest_preview_service
from app.modules.guest_previews.schemas import (
    GuestPreviewCreateRequest,
    GuestPreviewCreatedRead,
    GuestPreviewListItem,
    GuestPreviewRead,
)
from app.modules.guest_previews.service import GuestPreviewService
from app.shared.responses import APIResponse, success_response


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"


score_router = APIRouter(dependencies=[Depends(private_response)])
preview_router = APIRouter()


@score_router.post(
    "/{score_id}/guest-previews", response_model=APIResponse[GuestPreviewCreatedRead]
)
async def create_guest_preview(
    score_id: str,
    request: GuestPreviewCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return success_response(
        data=await service.create(
            db, score_id, require_persisted_id(current_user.id, entity="user"), request
        )
    )


@score_router.get(
    "/{score_id}/guest-previews", response_model=APIResponse[list[GuestPreviewListItem]]
)
async def list_guest_previews(
    score_id: str,
    limit: int = Query(default=100, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return success_response(
        data=await service.list(
            db, score_id, require_persisted_id(current_user.id, entity="user"), limit=limit
        )
    )


@score_router.post(
    "/guest-previews/{preview_id}/revoke", response_model=APIResponse[GuestPreviewListItem]
)
async def revoke_guest_preview(
    preview_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    return success_response(
        data=await service.revoke(
            db, preview_id, require_persisted_id(current_user.id, entity="user")
        )
    )


@score_router.delete("/guest-previews/{preview_id}", response_model=APIResponse[dict[str, bool]])
async def delete_guest_preview(
    preview_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    await service.delete(db, preview_id, require_persisted_id(current_user.id, entity="user"))
    return success_response(data={"deleted": True})


@preview_router.get("/{token}", response_model=APIResponse[GuestPreviewRead])
async def read_guest_preview(
    token: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
    service: GuestPreviewService = Depends(get_guest_preview_service),
):
    response.headers["Cache-Control"] = "private, no-store"
    return success_response(data=await service.read(db, token))


@preview_router.get("/{token}/render-assets/{asset_id}/view")
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
    response.headers["Cache-Control"] = "private, no-store"
    return response


@preview_router.get("/{token}/playback")
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
    response.headers["Cache-Control"] = "private, no-store"
    return response
