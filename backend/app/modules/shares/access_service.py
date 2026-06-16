"""Access and download helpers for authenticated share flows."""

from __future__ import annotations

from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AppException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.models import Share
from app.modules.shares.repository import SharesRepository
from app.modules.shares.schemas import ShareAccessResult, ShareDownloadFileItem
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class ShareAccessService:
    """Handle authenticated share-link access and download validation flows."""

    def __init__(self, repository: SharesRepository | None = None) -> None:
        self.repository = repository or SharesRepository()

    async def access_share(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> ShareAccessResult:
        share = await self._get_share_by_token(db, share_token, raise_on_invalid=False)
        if not share:
            raise AppException(
                code=ErrorCode.SHARE_NOT_FOUND,
                status_code=http_status.HTTP_404_NOT_FOUND,
                details={"share_token": share_token},
            )

        if share.revoked_at:
            raise AppException(
                code=ErrorCode.SHARE_REVOKED,
                status_code=http_status.HTTP_410_GONE,
                details={"share_token": share_token},
            )
        if share.expires_at and share.expires_at < utc_now_naive():
            raise AppException(
                code=ErrorCode.SHARE_EXPIRED,
                status_code=http_status.HTTP_410_GONE,
                details={"expired_at": share.expires_at.isoformat()},
            )

        task = await self.repository.get_task_by_id(db, share.task_id)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=str(share.task_id),
                code=ErrorCode.TASK_NOT_FOUND,
            )

        from app.db.worker_session import get_db_session
        from app.modules.tasks.worker_service import sync_task_service

        sync_db = get_db_session()
        try:
            status_data = sync_task_service.get_task_status(sync_db, task.task_uuid)
        finally:
            sync_db.close()

        owner = await self.repository.get_owner_by_id(db, share.owner_user_id)
        shared_by = owner.display_name if owner and owner.display_name else "anonymous"

        return {
            "task": status_data,
            "share_info": {
                "shared_by": shared_by,
                "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                "can_download": share.can_download,
                "can_edit": share.can_edit,
            },
        }

    async def validate_share_for_download(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> Share:
        share = await self.require_share_by_token(db, share_token)

        if share.revoked_at:
            raise ValidationException(code=ErrorCode.SHARE_REVOKED, field="share_token")
        if share.expires_at and share.expires_at < utc_now_naive():
            raise ValidationException(code=ErrorCode.SHARE_EXPIRED, field="share_token")
        if not share.can_download:
            raise UnauthorizedException(code=ErrorCode.SHARE_NO_DOWNLOAD)
        return share

    async def list_download_files(
        self,
        db: AsyncSession,
        share_token: str,
        file_type: str,
    ) -> list[ShareDownloadFileItem]:
        share = await self.validate_share_for_download(db, share_token)
        files = await self.repository.list_task_files_by_kind(db, share.task_id, file_type)
        return [
            {
                "storage_key": file.storage_key,
                "filename": file.filename,
                "page_number": file.page_number,
                "mime_type": file.mime_type,
            }
            for file in files
        ]

    async def get_share_by_token(
        self,
        db: AsyncSession,
        share_token: str,
        raise_on_invalid: bool = True,
    ) -> Share | None:
        return await self._get_share_by_token(db, share_token, raise_on_invalid=raise_on_invalid)

    async def require_share_by_token(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> Share:
        share = await self._get_share_by_token(db, share_token, raise_on_invalid=True)
        if share is None:
            raise ResourceNotFoundException(
                resource_type="share",
                resource_id=share_token,
                code=ErrorCode.SHARE_NOT_FOUND,
            )
        return share

    async def _get_share_by_token(
        self,
        db: AsyncSession,
        share_token: str,
        raise_on_invalid: bool = True,
    ) -> Share | None:
        share = await self.repository.get_share_by_token(db, share_token)
        if not share and raise_on_invalid:
            raise ResourceNotFoundException(
                resource_type="share",
                resource_id=share_token,
                code=ErrorCode.SHARE_NOT_FOUND,
            )
        return share


share_access_service = ShareAccessService()
