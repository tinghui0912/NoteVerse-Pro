from io import BytesIO

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.playback.service import PlaybackService, playback_service

router = APIRouter()


def get_playback_service() -> PlaybackService:
    return playback_service


@router.get("/scores/{score_id}/revisions/{revision_id}/playback")
async def stream_score_revision_playback(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PlaybackService = Depends(get_playback_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.score_revision_delivery(db, score_id, revision_id, user_id)
    return _stream(delivery, service)


@router.get("/score-grants/{token}/playback")
async def stream_score_grant_playback(
    token: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PlaybackService = Depends(get_playback_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.grant_delivery(db, token, user_id)
    return _stream(delivery, service)


@router.get("/publications/{slug}/playback")
async def stream_public_score_playback(
    slug: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: PlaybackService = Depends(get_playback_service),
):
    user_id = current_user.id if current_user else None
    delivery = await service.public_delivery(db, slug, user_id)
    return _stream(delivery, service)


def _stream(delivery, service: PlaybackService):
    return StreamingResponse(
        BytesIO(service.storage.read_bytes(delivery.storage_key)),
        media_type=delivery.media_type,
    )
