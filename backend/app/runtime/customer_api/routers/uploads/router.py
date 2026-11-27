from fastapi import Response, APIRouter, Depends, HTTPException

from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_db, get_command_db
from app.runtime.customer_api.deps import get_current_user
from app.db.models import User
from app.runtime.customer_api.resources import get_upload_service
from app.modules.uploads.schemas import UploadRead, UploadAdmissionRead
from app.modules.media_storage.upload_sessions.schemas import UploadCreateRequest
from app.modules.uploads.service import UploadService


router = APIRouter()


@router.post("", operation_id="uploadRequestsCreate", response_model=UploadAdmissionRead)
def create_upload_request(
    payload: UploadCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    upload_service: UploadService = Depends(get_upload_service),
):
    try:
        return upload_service.create_request(db, current_user.id, payload)
    except ValueError as error:
        raise HTTPException(409, "Upload admission rejected") from error


@router.post("/{session_id}/finalize", operation_id="uploadFinalize", response_model=UploadRead)
def finalize_upload(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    upload_service: UploadService = Depends(get_upload_service),
):
    try:
        return upload_service.finalize_upload(db, current_user.id, session_id)
    except ValueError as error:
        raise HTTPException(409, "Upload verification rejected") from error


@router.post(
    "/{session_id}/cancel",
    operation_id="uploadRequestCancel",
    status_code=204,
    response_class=Response,
)
def cancel_upload_request(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    upload_service: UploadService = Depends(get_upload_service),
):
    try:
        upload_service.cancel_request(db, current_user.id, session_id)
    except ValueError as error:
        raise HTTPException(409, "Upload cancellation rejected") from error
    return Response(status_code=204)


@router.delete(
    "/{upload_id}",
    operation_id="uploadDelete",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def delete_upload(
    upload_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    upload_service: UploadService = Depends(get_upload_service),
):
    upload_service.delete_upload(db, current_user, upload_id)
    return Response(status_code=204)


__all__ = ["router"]
