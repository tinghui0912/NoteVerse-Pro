from app.modules.scores.schemas import ScoreBatchDeleteRead

from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.api.media_delivery import deliver_media_object
from app.modules.media_storage.delivery import DeliveryMode
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.fingering.schemas import FingeringRequest, FingeringResultRead
from app.modules.fingering.service import FingeringService
from app.modules.revisions.schemas import (
    RevisionContentRead,
    RevisionCreateRequest,
    RevisionListRead,
    RevisionNoteUpdateRequest,
    RevisionRead,
    RevisionRestoreRequest,
)
from app.modules.revisions.service import RevisionService
from app.runtime.customer_api.resources import get_fingering_service
from app.runtime.customer_api.resources import get_revision_service, get_score_service
from app.modules.scores.schemas import (
    ScoreBatchDeleteRequest,
    ScoreRead,
    ScoreUpdateRequest,
)
from app.modules.scores.service import ScoreService


router = APIRouter()


@router.post("/batch-delete", operation_id="scoresBatchDelete", response_model=ScoreBatchDeleteRead)
def batch_delete_scores(
    request: ScoreBatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    removed = service.batch_delete(db, request.score_ids, user_id)
    return ScoreBatchDeleteRead(removed=removed)


@router.get("/{score_id}", operation_id="scoresGet", response_model=ScoreRead)
def get_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return service.get(db, score_id, user_id)


@router.patch("/{score_id}", operation_id="scoresUpdate", response_model=ScoreRead)
def update_score(
    score_id: str,
    request: ScoreUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.update(db, score_id, user_id, request)
    return result


@router.get(
    "/{score_id}/input-assets/{asset_id}/download",
    response_class=Response,
    responses=binary_responses("*/*"),
    operation_id="scoreInputAssetDownload",
)
def download_score_input_asset(
    score_id: str,
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = service.input_asset_delivery(db, score_id, asset_id, user_id)
    return deliver_media_object(
        service=service.delivery,
        mode=DeliveryMode.CONTROLLED_STREAM,
        target=delivery,
        attachment=True,
    )


@router.post(
    "/{score_id}/revisions",
    operation_id="scoreRevisionsCreate",
    response_model=RevisionRead,
)
def create_revision(
    score_id: str,
    request: RevisionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.create(db, score_id, user_id, request)
    return result


@router.get(
    "/{score_id}/revisions",
    operation_id="scoreRevisionsList",
    response_model=RevisionListRead,
)
def list_revisions(
    score_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    cursor: int | None = Query(default=None, ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.list(db, score_id, user_id, limit=limit, cursor=cursor)
    return result


@router.post(
    "/{score_id}/revisions/{revision_id}/restore",
    operation_id="scoreRevisionRestore",
    response_model=RevisionRead,
)
def restore_revision(
    score_id: str,
    revision_id: str,
    request: RevisionRestoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.restore(db, score_id, revision_id, user_id, request)
    return result


@router.patch(
    "/{score_id}/revisions/{revision_id}/note",
    operation_id="scoreRevisionNoteUpdate",
    response_model=RevisionRead,
)
def update_revision_note(
    score_id: str,
    revision_id: str,
    request: RevisionNoteUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.update_note(db, score_id, revision_id, user_id, request)
    return result


@router.get(
    "/{score_id}/revisions/{revision_id}/content",
    operation_id="scoreRevisionContentGet",
    response_model=RevisionContentRead,
)
def get_revision_content(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.content(db, score_id, revision_id, user_id)
    return result


def authorize_fingering_generation(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: FingeringService = Depends(get_fingering_service),
) -> None:
    service.authorize_generation(db, score_id, require_persisted_id(current_user.id, entity="user"))


@router.post(
    "/{score_id}/fingering",
    operation_id="scoreFingeringGenerate",
    response_model=FingeringResultRead,
    dependencies=[Depends(authorize_fingering_generation)],
)
async def generate_score_fingering(
    score_id: str,
    request: FingeringRequest,
    service: FingeringService = Depends(get_fingering_service),
):
    return await service.generate(score_id, request)
