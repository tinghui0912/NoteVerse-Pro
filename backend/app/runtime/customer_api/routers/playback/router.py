from app.runtime.customer_api.resources import get_playback_delivery_service
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.modules.media_storage.delivery import MediaAccessRead
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.playback.delivery import PlaybackDeliveryService
from app.modules.playback.performance_plan_service import compile_performance_plan
from app.modules.playback.performance_plan_schemas import (
    PerformancePlanRequest,
    PerformancePlanRead,
)

router = APIRouter()


@router.post(
    "/playback/performance-plan",
    operation_id="playbackPerformancePlanCreate",
    response_model=PerformancePlanRead,
)
def create_performance_plan(payload: PerformancePlanRequest) -> PerformancePlanRead:
    return compile_performance_plan(payload.musicxml)


@router.get(
    "/scores/{score_id}/revisions/{revision_id}/playback",
    response_model=MediaAccessRead,
    operation_id="scoreRevisionPlaybackAccessGet",
)
def get_score_revision_playback(
    score_id: str,
    revision_id: str,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PlaybackDeliveryService = Depends(get_playback_delivery_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = service.score_revision_delivery(db, score_id, revision_id, user_id)
    db.commit()
    db.close()
    response.headers["Cache-Control"] = "private, no-store"
    return service.delivery.access(delivery)
