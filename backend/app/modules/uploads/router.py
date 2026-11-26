from fastapi import Response, APIRouter, Depends, File, UploadFile, Form

from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_command_db
from app.db.models import User
from app.api.resource_dependencies import get_upload_service
from app.modules.uploads.schemas import UploadRead
from app.modules.uploads.service import UploadService


router = APIRouter()


@router.post("", operation_id="uploadsCreate", response_model=UploadRead)
def create_upload(
    file: UploadFile = File(...),
    client_request_id: str = Form(..., min_length=1, max_length=128),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    upload_service: UploadService = Depends(get_upload_service),
):
    result = upload_service.create_upload(
        db, current_user, file, client_request_id=client_request_id
    )
    return result


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
