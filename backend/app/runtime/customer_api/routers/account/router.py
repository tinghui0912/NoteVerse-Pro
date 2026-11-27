"""Current-user account routes."""

from app.runtime.customer_api.auth_services import get_session_service
from fastapi import Request

from app.modules.account.deletion_service import AccountDeletionService
from app.modules.account.schemas import DeleteAccountRequest, AccountDeletionRead
from app.modules.auth.session_cookies import clear_auth_session_cookie
from fastapi import Response, APIRouter, Depends, File, UploadFile, BackgroundTasks, HTTPException


import re
from fastapi.responses import RedirectResponse
from app.core.exceptions import ResourceNotFoundException
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_db, get_command_db
from app.runtime.customer_api.deps import get_current_user
from app.core.exceptions import FileException, ValidationException
from app.db.models import User, StoredObject
from app.db.model_utils import require_persisted_id
from sqlalchemy import select
from app.modules.media_storage.reads import StoredObjectDelivery
from app.modules.account.avatar_service import (
    AvatarService,
    AvatarFileTooLargeError,
    avatar_object_key,
)
from app.modules.account.dependencies import get_profile_service
from app.runtime.customer_api.resources import get_avatar_service
from app.modules.account.profile_service import ProfileService
from app.modules.account.schemas import (
    AvatarRead,
    ProfileRead,
    UpdateProfileRequest,
)
from app.shared.error_codes import CustomerErrorCode
from app.runtime.customer_api.context import get_context


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
        file_bytes = avatar_service.read_upload(file.file)
    except AvatarFileTooLargeError as exc:
        raise HTTPException(status_code=413, detail="Avatar exceeds the upload limit") from exc
    except OSError:
        raise FileException(code=CustomerErrorCode.FILE_READ_FAILED, filename=file.filename)

    try:
        saved_filename, avatar_url = avatar_service.replace_user_avatar(
            db,
            current_user,
            file_bytes=file_bytes,
            filename=file.filename or "",
        )
    except ValueError as exc:
        raise ValidationException(
            code=CustomerErrorCode.VALIDATION_ERROR,
            field="file",
        ) from exc
    except Exception:
        raise FileException(
            code=CustomerErrorCode.AVATAR_PROCESS_FAILED,
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
    db: Session = Depends(get_command_db, scope="function"),
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
        .where(StoredObject.object_key == avatar_object_key(filename), User.deleted_at.is_(None))
    )
    if current is None:
        raise ResourceNotFoundException("avatar", filename)
    delivery = avatar_service.delivery.deliver(
        StoredObjectDelivery.for_object(current, filename), public=True
    )
    assert delivery.location is not None
    return RedirectResponse(delivery.location, headers={"Cache-Control": delivery.cache_control})


@router.delete(
    "", operation_id="accountDelete", status_code=202, response_model=AccountDeletionRead
)
def delete_account(
    http_request: Request,
    request: DeleteAccountRequest,
    background_tasks: BackgroundTasks,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
) -> AccountDeletionRead:
    operation_id = AccountDeletionService(
        session_service=get_session_service(http_request)
    ).request_deletion(
        db,
        require_persisted_id(current_user.id, entity="user"),
        current_password=request.current_password,
    )
    clear_auth_session_cookie(response, config=http_request.app.state.settings)
    background_tasks.add_task(
        get_context().dispatches.account_deletion.dispatch_account_deletion_best_effort,
        operation_id,
    )
    return AccountDeletionRead(operation_id=operation_id)
