from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.practice.bundle.schemas import (
    PracticeBundleRead,
)
from app.modules.practice.bundle.service import PracticeBundleService


router = APIRouter()


def get_practice_bundle_service() -> PracticeBundleService:
    """Provide revision-bound source data without importing server practice runtime."""
    return PracticeBundleService()


@router.get(
    "/scores/{score_id}/revisions/{revision_id}/bundle",
    operation_id="practiceScoreRevisionBundleGet",
    response_model=PracticeBundleRead,
)
def read_bundle(
    score_id: str,
    revision_id: str,
    include_notation: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    practice_bundle_service: PracticeBundleService = Depends(get_practice_bundle_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = practice_bundle_service.read_bundle(
        db,
        score_id,
        user_id,
        revision_id,
        include_notation=include_notation,
    )
    return result
