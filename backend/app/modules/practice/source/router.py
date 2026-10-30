from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.practice.source.schemas import (
    PracticeSourceRead,
)
from app.modules.practice.source.service import PracticeSourceService
from app.shared.responses import APIResponse, success_response

router = APIRouter()


def get_practice_source_service() -> PracticeSourceService:
    """Provide revision-bound source data without importing server practice runtime."""
    return PracticeSourceService()


@router.get(
    "/scores/{score_id}/revisions/{revision_id}/source",
    response_model=APIResponse[PracticeSourceRead],
)
async def read_source(
    score_id: str,
    revision_id: str,
    include_notation: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_source_service: PracticeSourceService = Depends(get_practice_source_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_source_service.read_source(
        db,
        score_id,
        user_id,
        revision_id,
        include_notation=include_notation,
    )
    return success_response(data=result)
