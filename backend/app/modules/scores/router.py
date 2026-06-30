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
    RevisionRead,
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
from app.shared.responses import APIResponse, PaginatedResponse, paginated_response, success_response

router = APIRouter()


@router.get("", response_model=PaginatedResponse[ScoreRead])
async def list_scores(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    items, total = await service.list_owned(
        db, user_id, page=page, page_size=page_size, search=search
    )
    return paginated_response(items, page, page_size, total)


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


@router.delete("/{score_id}", response_model=APIResponse[None])
async def delete_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await service.delete(db, score_id, user_id)
    return success_response(message=SuccessCode.DELETE_SUCCESS)


@router.post("/{score_id}/approve", response_model=APIResponse[ScoreRead])
async def approve_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreService = Depends(get_score_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.approve(db, score_id, user_id)
    return success_response(data=result, message=SuccessCode.RECOGNITION_CONFIRMED)


@router.get("/{score_id}/revisions", response_model=APIResponse[list[RevisionRead]])
async def list_revisions(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionService = Depends(get_revision_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    items = await service.list(db, score_id, user_id)
    return success_response(data=items)


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




