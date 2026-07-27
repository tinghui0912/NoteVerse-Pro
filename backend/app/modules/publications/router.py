from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.api.storage_streaming import stream_storage_object
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.publications.dependencies import get_publication_service
from app.modules.publications.schemas import (
    PublicationRead,
    PublicationUpsertRequest,
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


@public_router.get("/{slug}/revision-sources/{source_id}/download")
async def download_public_revision_source(
    slug: str,
    source_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.public_revision_source_delivery(
        db, slug, source_id, user_id
    )
    return _stream_asset(delivery, service, attachment=True)


@public_router.get("/{slug}/render-assets/{render_asset_id}/download")
async def download_public_render_asset(
    slug: str,
    render_asset_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.public_render_asset_delivery(
        db, slug, render_asset_id, user_id
    )
    return _stream_asset(delivery, service, attachment=True)


@public_router.get("/{slug}/render-assets/{render_asset_id}/view")
async def view_public_render_asset(
    slug: str,
    render_asset_id: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PublicationService = Depends(get_publication_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.public_render_asset_delivery(
        db, slug, render_asset_id, user_id, download=False
    )
    return _stream_asset(delivery, service, attachment=False)


def _stream_asset(delivery, service: PublicationService, *, attachment: bool):
    return stream_storage_object(
        storage=service.asset_service.storage,
        storage_key=delivery.storage_key,
        filename=delivery.filename,
        media_type=delivery.media_type,
        attachment=attachment,
    )

