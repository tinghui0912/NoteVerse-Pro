from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.jobs.dependencies import get_job_service
from app.modules.jobs.schemas import BatchJobStatusRequest, JobSubmitRequest
from app.modules.jobs.service import JobService
from app.shared.constants import SuccessCode
from app.shared.responses import paginated_response, success_response

router = APIRouter()


@router.get("")
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: JobService = Depends(get_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    rows, total = await service.list_jobs(
        db, user_id, page=page, page_size=page_size
    )
    return paginated_response(rows, page, page_size, total)


@router.post("")
async def submit_job(
    request: JobSubmitRequest,
    current_user: User = Depends(get_current_user),
    service: JobService = Depends(get_job_service),
):
    result = await service.submit(current_user, request)
    return success_response(data=result, message=SuccessCode.PROCESSING_STARTED)


@router.post("/{job_id}/retry")
async def retry_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: JobService = Depends(get_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.retry(db, job_id, current_user, user_id)
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


@router.get("/{job_id}/artifacts/{artifact_id}/download")
async def download_job_artifact(
    job_id: str,
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: JobService = Depends(get_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.artifact_delivery(db, job_id, artifact_id, user_id)
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )
