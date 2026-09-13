from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.api.storage_streaming import stream_storage_object
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.playback.delivery import PlaybackDeliveryService

router = APIRouter()


def get_playback_delivery_service() -> PlaybackDeliveryService:
    return PlaybackDeliveryService()


@router.get("/scores/{score_id}/revisions/{revision_id}/playback")
async def stream_score_revision_playback(
    score_id: str,
    revision_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PlaybackDeliveryService = Depends(get_playback_delivery_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.score_revision_delivery(db, score_id, revision_id, user_id)
    return _stream(delivery, service, request)


@router.get("/score-grants/{token}/playback")
async def stream_score_grant_playback(
    token: str,
    request: Request,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PlaybackDeliveryService = Depends(get_playback_delivery_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.grant_delivery(db, token, user_id)
    return _stream(delivery, service, request)


@router.get("/publications/{slug}/playback")
async def stream_public_score_playback(
    slug: str,
    request: Request,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PlaybackDeliveryService = Depends(get_playback_delivery_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.public_delivery(db, slug, user_id)
    return _stream(delivery, service, request)


def _stream(delivery, service: PlaybackDeliveryService, request: Request):
    return stream_storage_object(
        storage=service.storage,
        storage_key=delivery.storage_key,
        filename=delivery.filename,
        media_type=delivery.media_type,
        attachment=False,
        request=request,
        enable_range=True,
    )
