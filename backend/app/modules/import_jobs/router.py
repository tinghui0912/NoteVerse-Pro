from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_command_db
from app.api.media_delivery import deliver_media_object
from app.modules.media_storage.delivery import DeliveryMode
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.api.resource_dependencies import get_import_job_service
from app.modules.import_jobs.schemas import (
    BatchImportJobStatusRequest,
    ImportJobBatchStatusRead,
    ImportJobRead,
    ImportJobSubmitRead,
    ImportJobSubmitRequest,
)
from app.modules.import_jobs.service import ImportJobService
from app.shared.pagination import PageNumberPage


router = APIRouter()


@router.get("", operation_id="importJobsList", response_model=PageNumberPage[ImportJobRead])
def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    rows, total = service.list_jobs(db, user_id, page=page, page_size=page_size)
    return PageNumberPage(items=rows, page=page, page_size=page_size, total=total)


@router.post(
    "",
    operation_id="importJobsSubmit",
    response_model=ImportJobSubmitRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def submit_job(
    request: ImportJobSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: ImportJobService = Depends(get_import_job_service),
):
    result = service.submit(db, current_user, request)
    return result


@router.post(
    "/{job_id}/retry",
    operation_id="importJobRetry",
    response_model=ImportJobSubmitRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.retry(db, job_id, current_user, user_id)
    return result


@router.get("/{job_id}", operation_id="importJobGet", response_model=ImportJobRead)
def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return service.detail(db, job_id, user_id)


@router.post(
    "/status/batch",
    operation_id="importJobsBatchStatusGet",
    response_model=ImportJobBatchStatusRead,
)
def batch_job_status(
    request: BatchImportJobStatusRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    jobs = service.batch_status(db, request.job_ids, user_id)
    return ImportJobBatchStatusRead(jobs=jobs)


@router.delete(
    "/{job_id}",
    operation_id="importJobDelete",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def delete_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    service.delete(db, job_id, user_id)
    return Response(status_code=204)


@router.get(
    "/{job_id}/artifacts/{artifact_id}/download",
    response_class=Response,
    responses=binary_responses("*/*"),
    operation_id="importJobArtifactDownload",
)
def download_job_artifact(
    job_id: str,
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: ImportJobService = Depends(get_import_job_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = service.artifact_delivery(db, job_id, artifact_id, user_id)
    return deliver_media_object(
        service=service.delivery,
        mode=DeliveryMode.CONTROLLED_STREAM,
        target=delivery,
        attachment=False,
    )
