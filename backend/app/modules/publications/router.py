from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.publications.dependencies import get_publication_service
from app.modules.publications.schemas import (
    PublicationRead,
    PublicationUpsertRequest,
    PublicScoreContentRead,
    PublicScoreRead,
)
from app.modules.publications.service import PublicationService
from app.shared.responses import APIResponse, success_response

score_router = APIRouter()
public_router = APIRouter()


@score_router.put("/{score_id}/publication", response_model=APIResponse[PublicationRead])
async def publish_score(
    score_id: str,
    request: PublicationUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.publish(db, score_id, user_id, request)
    return success_response(data=result)


@score_router.get("/{score_id}/publication", response_model=APIResponse[PublicationRead])
async def get_score_publication(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.get_for_score(db, score_id, user_id)
    return success_response(data=result)


@score_router.delete("/{score_id}/publication", response_model=APIResponse[PublicationRead])
async def unpublish_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.unpublish(db, score_id, user_id)
    return success_response(data=result)


@public_router.get("/{slug}", response_model=APIResponse[PublicScoreRead])
async def get_public_score(
    slug: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = current_user.id if current_user else None
    result = await service.public_detail(db, slug, user_id)
    return success_response(data=result)


@public_router.get("/{slug}/artifacts/{artifact_id}/download")
async def download_public_artifact(
    slug: str,
    artifact_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.public_artifact_delivery(
        db, slug, artifact_id, user_id
    )
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@public_router.get("/{slug}/content", response_model=APIResponse[PublicScoreContentRead])
async def get_public_score_content(
    slug: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = current_user.id if current_user else None
    result = await service.public_content(db, slug, user_id)
    return success_response(data=result)


@public_router.get("/{slug}/artifacts/{artifact_id}/view")
async def view_public_artifact(
    slug: str,
    artifact_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.public_artifact_delivery(
        db, slug, artifact_id, user_id, download=False
    )
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )

