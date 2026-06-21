"""Primary application service for share management flows."""

from __future__ import annotations

import secrets
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.constants import ErrorCode
from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.models import Share
from app.db.model_utils import require_persisted_id
from app.modules.shares.access_service import ShareAccessService
from app.modules.shares.collection_service import ShareCollectionService
from app.modules.shares.repository import SharesRepository
from app.modules.shares.schemas import (
    SavedShareListResult,
    ShareAccessResult,
    ShareCreateResult,
    ShareDownloadFileItem,
    ShareListItem,
    ShareListResponse,
    ShareRevokeResult,
)
from app.utils.timezone import utc_now_naive


class ShareService:
    """Share-domain application service."""

    def __init__(self, repository: SharesRepository | None = None) -> None:
        self.repository = repository or SharesRepository()
        self.access_service = ShareAccessService(self.repository)
        self.collection_service = ShareCollectionService(
            self.repository,
            access_service=self.access_service,
        )

    async def list_shares(
        self,
        db: AsyncSession,
        user_id: int,
        task_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> ShareListResponse:
        task = None
        if task_id:
            task = await self.repository.get_task_by_uuid(db, task_id)
            if not task:
                return {"shares": [], "total": 0, "page": page, "page_size": page_size}

        total = await self.repository.count_shares_for_owner(
            db,
            owner_user_id=user_id,
            task_db_id=task.id if task else None,
        )
        share_rows = await self.repository.list_share_rows_for_owner(
            db,
            owner_user_id=user_id,
            page=page,
            page_size=page_size,
            task_db_id=task.id if task else None,
        )

        share_list: list[ShareListItem] = []
        for share, share_task in share_rows:
            share_list.append(
                {
                    "id": share.id,
                    "share_token": share.token,
                    "task_id": share_task.task_uuid if share_task else None,
                    "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                    "can_download": share.can_download,
                    "can_edit": share.can_edit,
                    "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
                    "created_at": share.created_at.isoformat() if share.created_at else None,
                }
            )

        return {"shares": share_list, "total": total, "page": page, "page_size": page_size}

    async def create_share(
        self,
        db: AsyncSession,
        user_id: int,
        task_id: str,
        expires_in_days: int | None = 7,
        can_download: bool = True,
        can_edit: bool = False,
    ) -> ShareCreateResult:
        task = await self.repository.get_task_by_uuid(db, task_id)
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=task_id,
                code=ErrorCode.TASK_NOT_FOUND,
            )

        if task.user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_SHARE_ACCESS,
                details={"task_id": task_id},
            )

        share_token = secrets.token_urlsafe(32)
        expires_at = (
            utc_now_naive() + timedelta(days=expires_in_days)
            if expires_in_days is not None
            else None
        )
        task_id_db = require_persisted_id(task.id, entity="task")
        db.add(
            Share(
                task_id=task_id_db,
                token=share_token,
                owner_user_id=user_id,
                expires_at=expires_at,
                can_download=can_download,
                can_edit=can_edit,
                created_at=utc_now_naive(),
            )
        )
        await db.commit()
        return {
            "share_token": share_token,
            "expires_at": expires_at.isoformat() if expires_at else None,
        }

    async def remove_share(
        self,
        db: AsyncSession,
        share_token: str,
        user_id: int,
    ) -> None:
        share = await self._require_share_by_token(db, share_token)
        if share.owner_user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_DELETE_ACCESS,
                details={"share_token": share_token},
            )
        share_id = require_persisted_id(share.id, entity="share")
        await self.repository.delete_share_by_id(db, share_id)
        await db.commit()

    async def revoke_share(
        self,
        db: AsyncSession,
        share_token: str,
        user_id: int,
    ) -> ShareRevokeResult:
        share = await self._require_share_by_token(db, share_token)
        if share.owner_user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_ACCESS,
                details={"share_token": share_token},
            )

        if share.revoked_at is None:
            share.revoked_at = utc_now_naive()
            revoked = True
        else:
            share.revoked_at = None
            revoked = False

        await db.commit()
        return {
            "share_token": share_token,
            "revoked": revoked,
            "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
        }

    async def list_saved_shares(
        self,
        db: AsyncSession,
        user_id: int,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        search: str | None = None,
    ) -> SavedShareListResult:
        return await self.collection_service.list_saved_shares(
            db,
            user_id,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
            search=search,
        )

    async def access_share(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> ShareAccessResult:
        return await self.access_service.access_share(db, share_token)

    async def validate_share_for_download(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> Share:
        return await self.access_service.validate_share_for_download(db, share_token)

    async def list_download_files(
        self,
        db: AsyncSession,
        share_token: str,
        file_type: str,
    ) -> list[ShareDownloadFileItem]:
        return await self.access_service.list_download_files(db, share_token, file_type)

    async def save_to_collection(
        self,
        db: AsyncSession,
        share_token: str,
        user_id: int,
    ) -> bool:
        return await self.collection_service.save_to_collection(db, share_token, user_id)

    async def batch_delete_saved(
        self,
        db: AsyncSession,
        ids: list[int],
        user_id: int,
    ) -> int:
        return await self.collection_service.batch_delete_saved(db, ids, user_id)

    async def _get_share_by_token(
        self,
        db: AsyncSession,
        share_token: str,
        raise_on_invalid: bool = True,
    ) -> Share | None:
        return await self.access_service.get_share_by_token(
            db,
            share_token,
            raise_on_invalid=raise_on_invalid,
        )

    async def _require_share_by_token(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> Share:
        return await self.access_service.require_share_by_token(db, share_token)


share_service = ShareService()
