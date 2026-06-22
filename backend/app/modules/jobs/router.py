from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.jobs.dependencies import get_job_service
from app.modules.jobs.schemas import BatchJobStatusRequest, JobSubmitRequest
from app.modules.jobs.service import JobService
from app.shared.constants import SuccessCode
from app.shared.responses import success_response

router = APIRouter()


@router.post("")
async def submit_job(
    request: JobSubmitRequest,
    current_user: User = Depends(get_current_user),
    service: JobService = Depends(get_job_service),
):
    result = await service.submit(current_user, request)
    return success_response(data=result, message=SuccessCode.PROCESSING_STARTED)


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: JobService = Depends(get_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return success_response(data=await service.detail(db, job_id, user_id))


@router.post("/status/batch")
async def batch_job_status(
    request: BatchJobStatusRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: JobService = Depends(get_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    jobs = await service.batch_status(db, request.job_ids, user_id)
    return success_response(data={"jobs": jobs})


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: JobService = Depends(get_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await service.delete(db, job_id, user_id)
    return success_response(message=SuccessCode.DELETE_SUCCESS)
