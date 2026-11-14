from app.modules.scores.schemas import ScoreBatchDeleteRead

from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.storage_streaming import stream_storage_object
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
from app.modules.scores.dependencies import (
    get_fingering_service,
    get_revision_service,
    get_score_service,
)
from app.modules.scores.schemas import (
    ScoreBatchDeleteRequest,
    ScoreRead,
    ScoreUpdateRequest,
)
from app.modules.scores.service import ScoreService


router = APIRouter()


@router.post("/batch-delete", operation_id="scoresBatchDelete", response_model=ScoreBatchDeleteRead)
async def batch_delete_scores(
    request: ScoreBatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    removed = await service.batch_delete(db, request.score_ids, user_id)
    return ScoreBatchDeleteRead(removed=removed)


@router.get("/{score_id}", operation_id="scoresGet", response_model=ScoreRead)
async def get_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return await service.get(db, score_id, user_id)


@router.patch("/{score_id}", operation_id="scoresUpdate", response_model=ScoreRead)
async def update_score(
    score_id: str,
    request: ScoreUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.update(db, score_id, user_id, request)
    return result


@router.get(
    "/{score_id}/input-assets/{asset_id}/download",
    response_class=Response,
    responses=binary_responses("*/*"),
    operation_id="scoreInputAssetDownload",
)
async def download_score_input_asset(
    score_id: str,
    asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.input_asset_delivery(db, score_id, asset_id, user_id)
    return stream_storage_object(
        storage=service.storage,
        storage_key=delivery.storage_key,
        filename=delivery.filename,
        media_type=delivery.media_type,
        attachment=True,
    )


@router.post(
    "/{score_id}/revisions",
    operation_id="scoreRevisionsCreate",
    response_model=RevisionRead,
)
async def create_revision(
    score_id: str,
    request: RevisionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.create(db, score_id, user_id, request)
    return result


@router.get(
    "/{score_id}/revisions",
    operation_id="scoreRevisionsList",
    response_model=RevisionListRead,
)
async def list_revisions(
    score_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    cursor: int | None = Query(default=None, ge=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list(db, score_id, user_id, limit=limit, cursor=cursor)
    return result


@router.post(
    "/{score_id}/revisions/{revision_id}/restore",
    operation_id="scoreRevisionRestore",
    response_model=RevisionRead,
)
async def restore_revision(
    score_id: str,
    revision_id: str,
    request: RevisionRestoreRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.restore(db, score_id, revision_id, user_id, request)
    return result


@router.patch(
    "/{score_id}/revisions/{revision_id}/note",
    operation_id="scoreRevisionNoteUpdate",
    response_model=RevisionRead,
)
async def update_revision_note(
    score_id: str,
    revision_id: str,
    request: RevisionNoteUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.update_note(db, score_id, revision_id, user_id, request)
    return result


@router.get(
    "/{score_id}/revisions/{revision_id}/content",
    operation_id="scoreRevisionContentGet",
    response_model=RevisionContentRead,
)
async def get_revision_content(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.content(db, score_id, revision_id, user_id)
    return result


@router.post(
    "/{score_id}/fingering",
    operation_id="scoreFingeringGenerate",
    response_model=FingeringResultRead,
)
async def generate_score_fingering(
    score_id: str,
    request: FingeringRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: FingeringService = Depends(get_fingering_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.generate(db, score_id, user_id, request)
    return result
