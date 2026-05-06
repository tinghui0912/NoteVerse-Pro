"""Saved-share collection helpers for the shares module."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.model_utils import require_persisted_id
from app.modules.shares.access_service import ShareAccessService
from app.modules.shares.repository import SharesRepository
from app.modules.shares.schemas import SavedShareListItem, SavedShareListResult
from app.shared.file_kinds import FileKind


class ShareCollectionService:
    """Handle saved-share collection workflows."""

    def __init__(
        self,
        repository: SharesRepository | None = None,
        access_service: ShareAccessService | None = None,
    ) -> None:
        self.repository = repository or SharesRepository()
        self.access_service = access_service or ShareAccessService(self.repository)

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
        total = await self.repository.count_saved_shares(db, user_id, search)
        rows = await self.repository.list_saved_share_rows(
            db,
            user_id=user_id,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
            search=search,
        )

        task_ids = [require_persisted_id(row[1].id, entity="task") for row in rows]
        thumbnail_types = await self._get_thumbnail_types(db, task_ids)

        items: list[SavedShareListItem] = []
        for saved_share, task, share, owner in rows:
            task_db_id = require_persisted_id(task.id, entity="task")
            items.append(
                {
                    "id": saved_share.id,
                    "share_token": share.token,
                    "task_id": task.task_uuid,
                    "task_title": task.title or f"Task {task.task_uuid[:8]}",
                    "task_state": task.state.value if hasattr(task.state, "value") else str(task.state),
                    "thumbnail_type": thumbnail_types.get(task_db_id),
                    "shared_by": owner.display_name or owner.email.split("@")[0] or "anonymous",
                    "created_at": saved_share.created_at.isoformat() if saved_share.created_at else None,
                }
            )

        return {"items": items, "total": total}

    async def save_to_collection(
        self,
        db: AsyncSession,
        share_token: str,
        user_id: int,
    ) -> bool:
        share = await self.access_service.require_share_by_token(db, share_token)
        share_id = require_persisted_id(share.id, entity="share")
        existing = await self.repository.get_saved_share_by_share_and_user(db, share_id, user_id)
        if existing:
            return False
        self.repository.add_saved_share(db, share_id, user_id)
        await db.commit()
        return True

    async def batch_delete_saved(
        self,
        db: AsyncSession,
        ids: list[int],
        user_id: int,
    ) -> int:
        await self.repository.delete_saved_shares(db, ids, user_id)
        await db.commit()
        return len(ids)

    async def _get_thumbnail_types(
        self,
        db: AsyncSession,
        task_ids: list[int],
    ) -> dict[int, str]:
        if not task_ids:
            return {}

        rows = await self.repository.list_task_file_kinds(
            db,
            task_ids=task_ids,
            file_kinds=[
                FileKind.FINAL_IMAGE,
                FileKind.PREVIEW_IMAGE,
                FileKind.ORIGINAL_IMAGE,
            ],
        )

        task_file_kinds: dict[int, set[str]] = {}
        for task_id, kind in rows:
            task_file_kinds.setdefault(task_id, set()).add(kind.value if hasattr(kind, "value") else kind)

        result: dict[int, str] = {}
        for task_id, kinds in task_file_kinds.items():
            if FileKind.FINAL_IMAGE.value in kinds:
                result[task_id] = FileKind.FINAL_IMAGE.value
            elif FileKind.PREVIEW_IMAGE.value in kinds:
                result[task_id] = FileKind.PREVIEW_IMAGE.value
            elif FileKind.ORIGINAL_IMAGE.value in kinds:
                result[task_id] = FileKind.ORIGINAL_IMAGE.value
        return result


share_collection_service = ShareCollectionService()
