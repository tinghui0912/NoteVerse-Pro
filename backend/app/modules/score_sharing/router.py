from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.score_sharing.dependencies import get_score_sharing_service
from app.modules.score_sharing.schemas import BookmarkDeleteRequest, GrantCreateRequest
from app.modules.score_sharing.service import ScoreSharingService
from app.shared.responses import success_response

score_router = APIRouter()
grant_router = APIRouter()
bookmark_router = APIRouter()


@score_router.post("/{score_id}/grants")
async def create_score_grant(
    score_id: str,
    request: GrantCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.create_grant(db, score_id, user_id, request)
    return success_response(data=result.model_dump())


@score_router.get("/{score_id}/grants")
async def list_score_grants(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_grants(db, score_id, user_id)
    return success_response(data=[item.model_dump() for item in result])


@score_router.post("/grants/{grant_id}/revoke")
async def revoke_score_grant(
    grant_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.revoke_grant(db, grant_id, user_id)
    return success_response(data=result.model_dump())


@grant_router.get("/{token}")
async def access_score_grant(
    token: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    result = await service.access_grant(db, token, user_id)
    return success_response(data=result.model_dump())


@grant_router.post("/{token}/accept")
async def accept_score_edit_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.accept_edit_invite(db, token, user_id)
    return success_response(data=result.model_dump())


@grant_router.get("/{token}/content")
async def get_score_grant_content(
    token: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    result = await service.grant_content(db, token, user_id)
    return success_response(data=result.model_dump())


@grant_router.get("/{token}/artifacts/{artifact_id}/download")
async def download_score_grant_artifact(
    token: str,
    artifact_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.grant_artifact_delivery(
        db, token, artifact_id, user_id
    )
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@grant_router.get("/{token}/artifacts/{artifact_id}/view")
async def view_score_grant_artifact(
    token: str,
    artifact_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.grant_artifact_delivery(
        db, token, artifact_id, user_id, download=False
    )
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@grant_router.post("/{token}/bookmark")
async def bookmark_score_grant(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.bookmark_grant(db, token, user_id)
    return success_response(data=result.model_dump())


@bookmark_router.get("")
async def list_score_bookmarks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_bookmarks(db, user_id)
    return success_response(data=[item.model_dump() for item in result])


@bookmark_router.post("/batch-delete")
async def delete_score_bookmarks(
    request: BookmarkDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreSharingService = Depends(get_score_sharing_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    removed = await service.delete_bookmarks(db, request.bookmark_ids, user_id)
    return success_response(data={"removed": removed})
