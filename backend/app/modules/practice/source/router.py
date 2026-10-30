from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.practice.source.schemas import (
    PracticeSourceContentRead,
    PracticeSourceArtifactRead,
)
from app.modules.practice.source.service import PracticeSourceService
from app.shared.responses import APIResponse, success_response

router = APIRouter()


def get_practice_source_service() -> PracticeSourceService:
    """Provide revision-bound source data without importing server practice runtime."""
    return PracticeSourceService()


@router.get(
    "/scores/{score_id}/revisions/{revision_id}/source/artifact",
    response_model=APIResponse[PracticeSourceArtifactRead],
)
async def get_source_artifact(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_source_service: PracticeSourceService = Depends(get_practice_source_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_source_service.get_artifact(
        db,
        score_id,
        user_id,
        revision_id,
    )
    return success_response(data=result)


@router.get(
    "/scores/{score_id}/revisions/{revision_id}/source/content",
    response_model=APIResponse[PracticeSourceContentRead],
)
async def get_source_content(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    practice_source_service: PracticeSourceService = Depends(get_practice_source_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await practice_source_service.get_content(
        db,
        score_id,
        user_id,
        revision_id,
    )
    return success_response(data=result)
