from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.score_sharing.dependencies import get_score_sharing_service
from app.modules.score_sharing.schemas import (
    GrantAccessRead,
    GrantBookmarkRead,
    GrantCreateRequest,
    GrantCreatedRead,
    GrantRead,
)
from app.modules.score_sharing.service import ScoreSharingService
from app.shared.responses import APIResponse, success_response

score_router = APIRouter()
grant_router = APIRouter()


@score_router.post("/{score_id}/grants", response_model=APIResponse[GrantCreatedRead])
async def create_score_grant(
    score_id: str,
    request: GrantCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.create_grant(db, score_id, user_id, request)
    return success_response(data=result)


@score_router.get("/{score_id}/grants", response_model=APIResponse[list[GrantRead]])
async def list_score_grants(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_grants(db, score_id, user_id)
    return success_response(data=result)


@score_router.post("/grants/{grant_id}/revoke", response_model=APIResponse[GrantRead])
async def revoke_score_grant(
    grant_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.revoke_grant(db, grant_id, user_id)
    return success_response(data=result)


@score_router.post("/grants/{grant_id}/restore", response_model=APIResponse[GrantRead])
async def restore_score_grant(
    grant_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.restore_grant(db, grant_id, user_id)
    return success_response(data=result)


@score_router.delete("/grants/{grant_id}", response_model=APIResponse[dict[str, bool]])
async def delete_score_grant(
    grant_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await service.delete_grant(db, grant_id, user_id)
    return success_response(data={"deleted": True})


@grant_router.get("/{token}", response_model=APIResponse[GrantAccessRead])
async def access_score_grant(
    token: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    result = await service.access_grant(db, token, user_id)
    return success_response(data=result)


@grant_router.get("/{token}/revision-sources/{source_id}/download")
async def download_score_grant_revision_source(
    token: str,
    source_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.grant_revision_source_delivery(
        db, token, source_id, user_id
    )
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@grant_router.get("/{token}/render-assets/{render_asset_id}/download")
async def download_score_grant_render_asset(
    token: str,
    render_asset_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.grant_render_asset_delivery(
        db, token, render_asset_id, user_id
    )
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@grant_router.get("/{token}/render-assets/{render_asset_id}/view")
async def view_score_grant_render_asset(
    token: str,
    render_asset_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.grant_render_asset_delivery(
        db, token, render_asset_id, user_id, download=False
    )
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@grant_router.post("/{token}/bookmark", response_model=APIResponse[GrantBookmarkRead])
async def bookmark_score_grant(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.bookmark_grant(db, token, user_id)
    return success_response(data=result)


