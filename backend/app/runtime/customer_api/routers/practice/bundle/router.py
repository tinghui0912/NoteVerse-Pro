from __future__ import annotations


from fastapi import APIRouter, Depends
from app.runtime.customer_api.resources import get_practice_bundle_service
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.practice.bundle.schemas import (
    PracticeBundleRead,
)
from app.modules.practice.bundle.service import PracticeBundleService


router = APIRouter()


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
