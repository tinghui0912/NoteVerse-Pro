from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.storage_streaming import stream_storage_object
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.import_jobs.dependencies import get_import_job_service
from app.modules.import_jobs.schemas import (
    BatchImportJobStatusRequest,
    ImportJobBatchStatusRead,
    ImportJobRead,
    ImportJobSubmitRead,
    ImportJobSubmitRequest,
)
from app.modules.import_jobs.service import ImportJobService
from app.shared.constants import SuccessCode
from app.shared.responses import APIResponse, EmptyResponse, PaginatedResponse, paginated_response, success_response

router = APIRouter()


@router.get("", response_model=PaginatedResponse[ImportJobRead])
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    rows, total = await service.list_jobs(
        db, user_id, page=page, page_size=page_size
    )
    return paginated_response(rows, page, page_size, total)


@router.post("", response_model=APIResponse[ImportJobSubmitRead], status_code=status.HTTP_202_ACCEPTED)
async def submit_job(
    request: ImportJobSubmitRequest,
    current_user: User = Depends(get_current_user),
    service: ImportJobService = Depends(get_import_job_service),
):
    result = await service.submit(current_user, request)
    return success_response(data=result, message=SuccessCode.IMPORT_JOB_ACCEPTED)


@router.post("/{job_id}/retry", response_model=APIResponse[ImportJobSubmitRead], status_code=status.HTTP_202_ACCEPTED)
async def retry_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.retry(db, job_id, current_user, user_id)
    return success_response(data=result, message=SuccessCode.IMPORT_JOB_ACCEPTED)


@router.get("/{job_id}", response_model=APIResponse[ImportJobRead])
async def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return success_response(data=await service.detail(db, job_id, user_id))


@router.post("/status/batch", response_model=APIResponse[ImportJobBatchStatusRead])
async def batch_job_status(
    request: BatchImportJobStatusRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    jobs = await service.batch_status(db, request.job_ids, user_id)
    return success_response(data=ImportJobBatchStatusRead(jobs=jobs))


@router.delete("/{job_id}", response_model=EmptyResponse)
async def delete_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
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
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.artifact_delivery(db, job_id, artifact_id, user_id)
    return stream_storage_object(
        storage=service.storage,
        storage_key=delivery.storage_key,
        filename=delivery.filename,
        media_type=delivery.media_type,
        attachment=False,
    )
