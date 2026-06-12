"""
User profile routes under the profile module boundary.
"""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.shared.constants import ErrorCode, SuccessCode
from app.core.exceptions import (
    AuthenticationException,
    FileException,
    ResourceAlreadyExistsException,
    ValidationException,
)
from app.core.security import get_password_hash, verify_password
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.profile.dependencies import get_avatar_service
from app.modules.profile.schemas import ChangePasswordRequest, UpdateProfileRequest
from app.modules.profile.service import AvatarService
from app.modules.auth.dependencies import get_auth_service
from app.modules.auth.service import AuthService
from app.shared.responses import success_response
from app.utils.timezone import utc_now_naive

router = APIRouter()


@router.get("")
async def get_user_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return success_response(
        data={
            "user": {
                "id": current_user.id,
                "email": current_user.email,
                "display_name": current_user.display_name or current_user.email.split("@")[0],
                "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
                "is_active": current_user.is_active,
                "avatar_url": current_user.avatar_url,
            }
        }
    )


@router.put("")
async def update_user_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    auth_service: AuthService = Depends(get_auth_service),
):
    updated_fields = []

    if request.email and request.email != current_user.email:
        existing_result = await db.execute(select(User).where(User.email == request.email))
        if existing_result.scalars().first():
            raise ResourceAlreadyExistsException(
                resource_type="email",
                details={"email": request.email},
            )
        current_user.email = request.email
        updated_fields.append("email")

    if request.new_password:
        if not request.current_password:
            raise ValidationException(
                code=ErrorCode.CURRENT_PASSWORD_REQUIRED,
                field="current_password",
            )
        if not verify_password(request.current_password, current_user.password_hash):
            raise AuthenticationException(
                code=ErrorCode.CURRENT_PASSWORD_WRONG,
                details={"field": "current_password"},
            )
        changed_at = utc_now_naive()
        current_user.password_hash = get_password_hash(request.new_password)
        current_user.password_changed_at = changed_at
        await auth_service.revoke_user_refresh_tokens(
            db,
            require_persisted_id(current_user.id, entity="user"),
            revoked_at=changed_at,
            commit=False,
        )
        updated_fields.append("password")

    if updated_fields:
        await db.commit()

    return success_response(
        data={"updated_fields": updated_fields},
        message=SuccessCode.PROFILE_UPDATED,
    )


@router.post("/password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    auth_service: AuthService = Depends(get_auth_service),
):
    if not verify_password(request.current_password, current_user.password_hash):
        raise AuthenticationException(
            code=ErrorCode.CURRENT_PASSWORD_WRONG,
            details={"field": "current_password"},
        )

    changed_at = utc_now_naive()
    current_user.password_hash = get_password_hash(request.new_password)
    current_user.password_changed_at = changed_at
    await auth_service.revoke_user_refresh_tokens(
        db,
        require_persisted_id(current_user.id, entity="user"),
        revoked_at=changed_at,
        commit=False,
    )
    await db.commit()
    return success_response(message=SuccessCode.PASSWORD_CHANGED)


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
