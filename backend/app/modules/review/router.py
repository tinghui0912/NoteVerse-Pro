from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.review.dependencies import get_review_service
from app.modules.review.schemas import (
    JobReviewRead,
    ReviewConfirmRead,
    ReviewConfirmRequest,
    ReviewUpdateRequest,
)
from app.modules.review.service import ReviewService
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.get("/{job_id}", response_model=APIResponse[JobReviewRead])
async def get_job_review(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ReviewService = Depends(get_review_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.detail(db, job_id, user_id)
    return success_response(data=result)


@router.patch("/{job_id}", response_model=APIResponse[JobReviewRead])
async def update_job_review(
    job_id: str,
    request: ReviewUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ReviewService = Depends(get_review_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.update(db, job_id, user_id, request)
    return success_response(data=result)


@router.post("/{job_id}/confirm", response_model=APIResponse[ReviewConfirmRead])
async def confirm_job_review(
    job_id: str,
    request: ReviewConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ReviewService = Depends(get_review_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.confirm(db, job_id, user_id, request)
    return success_response(data=result)
