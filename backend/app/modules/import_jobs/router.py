from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.import_jobs.dependencies import get_import_job_service
from app.modules.import_jobs.schemas import BatchImportJobStatusRequest, ImportJobSubmitRequest
from app.modules.import_jobs.service import ImportJobService
from app.shared.constants import SuccessCode
from app.shared.responses import paginated_response, success_response

router = APIRouter()


@router.get("")
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


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def submit_job(
    request: ImportJobSubmitRequest,
    current_user: User = Depends(get_current_user),
    service: ImportJobService = Depends(get_import_job_service),
):
    result = await service.submit(current_user, request)
    return success_response(data=result, message=SuccessCode.IMPORT_JOB_ACCEPTED)


@router.post("/{job_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.retry(db, job_id, current_user, user_id)
    return success_response(data=result, message=SuccessCode.IMPORT_JOB_ACCEPTED)


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return success_response(data=await service.detail(db, job_id, user_id))


@router.post("/status/batch")
async def batch_job_status(
    request: BatchImportJobStatusRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    jobs = await service.batch_status(db, request.job_ids, user_id)
    return success_response(data={"jobs": jobs})


@router.delete("/{job_id}")
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
    headers = {
        "Content-Disposition": (
            f"inline; filename*=UTF-8''{quote(delivery.filename)}"
        )
    }
    return StreamingResponse(
        BytesIO(service.storage.read_bytes(delivery.storage_key)),
        media_type=delivery.media_type,
        headers=headers,
    )
