from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.api.resource_dependencies import get_import_review_service
from app.modules.import_jobs.review.schemas import (
    ImportJobReviewRead,
    ReviewConfirmRead,
    ReviewConfirmRequest,
    ReviewUpdateRequest,
)
from app.modules.import_jobs.review.service import ImportReviewService


router = APIRouter()


@router.get(
    "/{job_id}/review", operation_id="importJobReviewGet", response_model=ImportJobReviewRead
)
def get_import_job_review(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ImportReviewService = Depends(get_import_review_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.detail(db, job_id, user_id)
    return result


@router.patch(
    "/{job_id}/review",
    operation_id="importJobReviewUpdate",
    response_model=ImportJobReviewRead,
)
def update_import_job_review(
    job_id: str,
    request: ReviewUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ImportReviewService = Depends(get_import_review_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.update(db, job_id, user_id, request)
    return result


@router.post(
    "/{job_id}/review/confirm",
    operation_id="importJobReviewConfirm",
    response_model=ReviewConfirmRead,
)
def confirm_import_job_review(
    job_id: str,
    request: ReviewConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ImportReviewService = Depends(get_import_review_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.confirm(db, job_id, user_id, request)
    return result
