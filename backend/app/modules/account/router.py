"""Current-user account routes."""

from fastapi import Response, APIRouter, Depends, File, UploadFile


import re
from fastapi.responses import RedirectResponse
from app.core.exceptions import ResourceNotFoundException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.exceptions import FileException, ValidationException
from app.db.models import User, StoredObject
from sqlalchemy import select
from app.modules.account.avatar_service import AvatarService, avatar_object_key
from app.modules.account.dependencies import get_avatar_service, get_profile_service
from app.modules.account.profile_service import ProfileService
from app.modules.account.schemas import (
    AvatarRead,
    ProfileRead,
    UpdateProfileRequest,
)
from app.shared.constants import ErrorCode


router = APIRouter()


@router.get("/profile", operation_id="accountProfileGet", response_model=ProfileRead)
def get_user_profile(
    current_user: User = Depends(get_current_user),
    profile_service: ProfileService = Depends(get_profile_service),
):
    return profile_service.profile_payload(current_user)


@router.put(
    "/profile",
    operation_id="accountProfileUpdate",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def update_user_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    profile_service: ProfileService = Depends(get_profile_service),
):
    profile_service.update_profile(db, current_user, request)
    return Response(status_code=204)


@router.post("/avatar", operation_id="accountAvatarUpload", response_model=AvatarRead)
def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    avatar_service: AvatarService = Depends(get_avatar_service),
):
    try:
        file_bytes = file.file.read()
    except Exception:
        raise FileException(code=ErrorCode.FILE_READ_FAILED, filename=file.filename)

    try:
        saved_filename, avatar_url = avatar_service.replace_user_avatar(
            db,
            current_user,
            file_bytes=file_bytes,
            filename=file.filename,
        )
    except ValueError as exc:
        raise ValidationException(
            code=ErrorCode.VALIDATION_ERROR,
            field="file",
        ) from exc
    except Exception:
        raise FileException(
            code=ErrorCode.AVATAR_PROCESS_FAILED,
            filename=file.filename,
        )

    return {"avatar_url": avatar_url, "filename": saved_filename}


@router.delete(
    "/avatar",
    operation_id="accountAvatarDelete",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    avatar_service: AvatarService = Depends(get_avatar_service),
):
    avatar_service.clear_user_avatar(db, current_user)
    return Response(status_code=204)


@router.get(
    "/avatars/{filename}",
    operation_id="accountAvatarResolve",
    response_class=RedirectResponse,
    status_code=307,
    responses={
        307: {
            "description": "Redirect to a fresh profile-image object capability; no response body.",
            "headers": {"Location": {"schema": {"type": "string", "format": "uri"}}},
        }
    },
)
def read_avatar(
    filename: str,
    db: Session = Depends(get_db, scope="function"),
    avatar_service: AvatarService = Depends(get_avatar_service),
):
    """Issue a fresh object capability for a public profile image."""
    if not re.fullmatch(r"[0-9]+_[0-9a-f]{64}_[0-9a-f]{32}\.jpg", filename):
        raise ResourceNotFoundException("avatar", filename)
    current = db.scalar(
        select(StoredObject)
        .join(User, User.avatar_object_id == StoredObject.id)
        .where(StoredObject.object_key == avatar_object_key(filename))
    )
    if current is None or not avatar_service.avatar_exists(filename):
        raise ResourceNotFoundException("avatar", filename)
    return RedirectResponse(
        avatar_service.storage.download_url(current.object_key, content_type=current.content_type)
    )
