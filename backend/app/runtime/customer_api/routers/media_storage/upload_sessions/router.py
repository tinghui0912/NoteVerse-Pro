"""Authenticated capabilities and completion for server-bound upload sessions."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.platform.db.dependencies import get_db
from app.runtime.customer_api.deps import get_current_user
from app.db.model_utils import require_persisted_id
from app.runtime.customer_api.resources import get_upload_session_service
from app.db.models import User
from app.modules.media_storage.upload_sessions.service import UploadSessionService
from app.modules.media_storage.upload_sessions.schemas import (
    UploadSessionRead,
    UploadTargetRead,
    UploadPartRead,
)

router = APIRouter()


def upload_user_id(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
) -> int:
    identity = require_persisted_id(user.id, entity="user")
    db.commit()
    db.close()
    return identity


@router.get("/{session_id}", response_model=UploadSessionRead, operation_id="uploadSessionsGet")
def read_upload_session(
    session_id: str,
    user_id: int = Depends(upload_user_id),
    service: UploadSessionService = Depends(get_upload_session_service),
):
    try:
        return service.read(session_id, user_id)
    except ValueError as error:
        raise HTTPException(409, "Upload session is unavailable") from error


@router.post(
    "/{session_id}/parts/{part_number}/upload-url",
    response_model=UploadTargetRead,
    operation_id="uploadSessionPartUploadUrlCreate",
)
def part_upload_url(
    session_id: str,
    part_number: int,
    user_id: int = Depends(upload_user_id),
    service: UploadSessionService = Depends(get_upload_session_service),
):
    try:
        return service.part_url(session_id, user_id, part_number)
    except ValueError as error:
        raise HTTPException(409, "Upload part is unavailable") from error


@router.get(
    "/{session_id}/parts",
    response_model=list[UploadPartRead],
    operation_id="uploadSessionPartsList",
)
def uploaded_parts(
    session_id: str,
    user_id: int = Depends(upload_user_id),
    service: UploadSessionService = Depends(get_upload_session_service),
):
    try:
        return service.parts(session_id, user_id)
    except ValueError as error:
        raise HTTPException(409, "Upload parts are unavailable") from error


@router.post(
    "/{session_id}/complete", response_model=UploadSessionRead, operation_id="uploadSessionComplete"
)
def complete_upload_session(
    session_id: str,
    user_id: int = Depends(upload_user_id),
    service: UploadSessionService = Depends(get_upload_session_service),
):
    try:
        return service.complete(session_id, user_id)
    except ValueError as error:
        raise HTTPException(409, "Upload verification failed") from error
