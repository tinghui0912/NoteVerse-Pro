from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.revisions.schemas import (
    FingeringRequest,
    FingeringResultRead,
    RevisionContentRead,
    RevisionCreateRequest,
    RevisionListRead,
    RevisionNoteUpdateRequest,
    RevisionRead,
    RevisionRestoreRequest,
)
from app.modules.revisions.service import RevisionService
from app.modules.scores.dependencies import get_revision_service, get_score_service
from app.modules.scores.schemas import (
    ScoreBatchDeleteRequest,
    ScoreRead,
    ScoreUpdateRequest,
)
from app.modules.scores.service import ScoreService
from app.shared.constants import SuccessCode
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.post("/batch-delete", response_model=APIResponse[dict[str, int]])
async def batch_delete_scores(
    request: ScoreBatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    removed = await service.batch_delete(db, request.score_ids, user_id)
    return success_response(data={"removed": removed})


@router.get("/{score_id}", response_model=APIResponse[ScoreRead])
async def get_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return success_response(data=await service.get(db, score_id, user_id))


@router.patch("/{score_id}", response_model=APIResponse[ScoreRead])
async def update_score(
    score_id: str,
    request: ScoreUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.update(db, score_id, user_id, request)
    return success_response(data=result, message=SuccessCode.UPDATE_SUCCESS)


@router.post("/{score_id}/revisions", response_model=APIResponse[RevisionRead])
async def create_revision(
    score_id: str,
    request: RevisionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.create(db, score_id, user_id, request)
    return success_response(data=result, message=SuccessCode.SAVE_SUCCESS)


@router.get("/{score_id}/revisions", response_model=APIResponse[RevisionListRead])
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
    return success_response(data=result)


@router.post("/{score_id}/revisions/{revision_id}/restore", response_model=APIResponse[RevisionRead])
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
    return success_response(data=result, message=SuccessCode.SAVE_SUCCESS)


@router.patch("/{score_id}/revisions/{revision_id}/note", response_model=APIResponse[RevisionRead])
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
    return success_response(data=result, message=SuccessCode.UPDATE_SUCCESS)


@router.get("/{score_id}/revisions/{revision_id}/content", response_model=APIResponse[RevisionContentRead])
async def get_revision_content(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.content(db, score_id, revision_id, user_id)
    return success_response(data=result)


@router.post("/{score_id}/fingering", response_model=APIResponse[FingeringResultRead])
async def generate_score_fingering(
    score_id: str,
    request: FingeringRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.generate_fingering(db, score_id, user_id, request)
    return success_response(data=result, message=SuccessCode.FINGERING_GENERATED)
