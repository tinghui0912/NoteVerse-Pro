"""Current-user account routes."""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.exceptions import FileException, ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.account.avatar_service import AvatarService
from app.modules.account.dependencies import get_avatar_service, get_profile_service
from app.modules.account.profile_service import ProfileService
from app.modules.account.schemas import UpdateProfileRequest
from app.shared.constants import ErrorCode, SuccessCode
from app.shared.responses import success_response

router = APIRouter()


@router.get("/profile")
async def get_user_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    avatar_service: AvatarService = Depends(get_avatar_service),
    profile_service: ProfileService = Depends(get_profile_service),
):
    return success_response(
        data=await profile_service.profile_payload(db, current_user, avatar_service)
    )


@router.put("/profile")
async def update_user_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    profile_service: ProfileService = Depends(get_profile_service),
):
    updated_fields = await profile_service.update_profile(db, current_user, request)
    return success_response(
        data={"updated_fields": updated_fields},
        message=SuccessCode.PROFILE_UPDATED,
    )


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    avatar_service: AvatarService = Depends(get_avatar_service),
):
    try:
        file_bytes = await file.read()
    except Exception:
        raise FileException(code=ErrorCode.FILE_READ_FAILED, filename=file.filename)

    try:
        user_id = require_persisted_id(current_user.id, entity="user")
        saved_filename, avatar_url = avatar_service.process_avatar(
            file_bytes=file_bytes,
            filename=file.filename,
            user_id=user_id,
        )
    except ValueError as exc:
        raise ValidationException(
            code=ErrorCode.VALIDATION_ERROR,
            field="file",
            details={"error": str(exc)},
        )
    except Exception as exc:
        raise FileException(
            code=ErrorCode.AVATAR_PROCESS_FAILED,
            filename=file.filename,
            details={"error": str(exc)},
        )

    if current_user.avatar_url:
        old_filename = current_user.avatar_url.split("/")[-1]
        if old_filename != saved_filename:
            avatar_service.delete_avatar(old_filename)

    current_user.avatar_url = avatar_url
    await db.commit()
    await db.refresh(current_user)

    return success_response(
        data={"avatar_url": avatar_url, "filename": saved_filename},
        message=SuccessCode.AVATAR_UPLOADED,
    )


@router.delete("/avatar")
async def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    avatar_service: AvatarService = Depends(get_avatar_service),
):
    if not current_user.avatar_url:
        return success_response(message=SuccessCode.AVATAR_DELETED)

    filename = current_user.avatar_url.split("/")[-1]
    avatar_service.delete_avatar(filename)
    current_user.avatar_url = None
    await db.commit()
    return success_response(message=SuccessCode.AVATAR_DELETED)
