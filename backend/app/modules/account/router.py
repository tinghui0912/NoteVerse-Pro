"""Current-user account routes."""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.exceptions import FileException, ValidationException
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
    profile_service: ProfileService = Depends(get_profile_service),
):
    return success_response(data=profile_service.profile_payload(current_user))


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
        saved_filename, avatar_url = await avatar_service.replace_user_avatar(
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
    await avatar_service.clear_user_avatar(db, current_user)
    return success_response(message=SuccessCode.AVATAR_DELETED)
