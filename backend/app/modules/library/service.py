from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.exceptions import (
    ResourceAlreadyExistsException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    LibraryEntrySourceType,
    LibraryPracticeState,
    Score,
    ScoreDeletionStatus,
    ScoreLibraryEntry,
    ScoreLibraryFolder,
    ScoreRevision,
    ScoreRevisionMetadata,
)
from app.modules.library.repository import LibraryRepository
from app.modules.library.schemas import (
    FolderDeleteMode,
    LibraryEntryBatchMoveRequest,
    LibraryEntryBatchPracticeStateRequest,
    LibraryEntryBatchUpdateRequest,
    LibraryEntryRead,
    LibraryEntryUpdateRequest,
    LibraryFolderCreateRequest,
    LibraryFolderDeleteRequest,
    LibraryFolderRead,
    LibraryFolderOverviewRead,
    LibraryFolderUpdateRequest,
    LibraryOwnedScoreBatchRequest,
    LibrarySort,
    LibraryView,
)
from app.modules.metadata.service import MetadataProjectionService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.derived_assets import score_derived_assets
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.schemas import ScoreDerivedAssetRead, ScoreDerivedAssetsRead
from app.modules.scores.repository import ScoreRepository
from app.utils.timezone import utc_now_naive


class LibraryService:
    def __init__(
        self,
        repository: LibraryRepository | None = None,
        score_repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or LibraryRepository()
        self.score_repository = score_repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()

    async def ensure_entry(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        score_id: int,
        source_type: LibraryEntrySourceType,
        favorite: bool = False,
    ) -> ScoreLibraryEntry:
        entry = await self.repository.entry_including_deleted(db, user_id, score_id, source_type)
        if entry:
            if entry.deleted_at is not None:
                entry.deleted_at = None
                entry.folder_id = None
                entry.practice_state = LibraryPracticeState.TO_PRACTICE
                entry.last_practiced_at = None
            if favorite and not entry.is_favorite:
                entry.is_favorite = True
            entry.updated_at = utc_now_naive()
            return entry
        now = utc_now_naive()
        entry = ScoreLibraryEntry(
            user_id=user_id,
            score_id=score_id,
            source_type=source_type,
            is_favorite=favorite,
            created_at=now,
            updated_at=now,
        )
        db.add(entry)
        return entry

    async def folder_overview(self, db: AsyncSession, user_id: int) -> LibraryFolderOverviewRead:
        folders = await self.repository.folders(db, user_id)
        (
            all_count,
            favorite_count,
            recent_practice_count,
            to_practice_count,
            mastered_count,
            score_counts,
        ) = await self.repository.counts(db, user_id)
        return LibraryFolderOverviewRead(
            all_count=all_count,
            favorite_count=favorite_count,
            recent_practice_count=recent_practice_count,
            to_practice_count=to_practice_count,
            mastered_count=mastered_count,
            folders=[
                LibraryFolderRead(
                    folder_id=folder.folder_uuid,
                    name=folder.name,
                    position=folder.position,
                    score_count=score_counts.get(
                        require_persisted_id(folder.id, entity="library folder"), 0
                    ),
                    created_at=folder.created_at,
                    updated_at=folder.updated_at,
                )
                for folder in folders
            ],
        )

    async def create_folder(
        self, db: AsyncSession, user_id: int, request: LibraryFolderCreateRequest
    ) -> LibraryFolderRead:
        now = utc_now_naive()
        folder = ScoreLibraryFolder(
            user_id=user_id,
            name=request.name,
            created_at=now,
            updated_at=now,
        )
        db.add(folder)
        try:
            await db.commit()
        except Exception as exc:
            await db.rollback()
            raise ResourceAlreadyExistsException("library_folder") from exc
        return await self._folder_read(db, user_id, folder.folder_uuid)

    async def update_folder(
        self,
        db: AsyncSession,
        user_id: int,
        folder_uuid: str,
        request: LibraryFolderUpdateRequest,
    ) -> LibraryFolderRead:
        folder = await self.repository.folder_by_uuid(db, user_id, folder_uuid, lock=True)
        if not folder:
            raise ResourceNotFoundException("library_folder", folder_uuid)
        if request.name is not None:
            folder.name = request.name
        if request.position is not None:
            folder.position = request.position
        folder.updated_at = utc_now_naive()
        try:
            await db.commit()
        except Exception as exc:
            await db.rollback()
            raise ResourceAlreadyExistsException("library_folder") from exc
        return await self._folder_read(db, user_id, folder.folder_uuid)

    async def delete_folder(
        self,
        db: AsyncSession,
        user_id: int,
        folder_uuid: str,
        request: LibraryFolderDeleteRequest,
    ) -> None:
        folder = await self.repository.folder_by_uuid(db, user_id, folder_uuid, lock=True)
        if not folder:
            raise ResourceNotFoundException("library_folder", folder_uuid)
        folder_id = require_persisted_id(folder.id, entity="library folder")
        now = utc_now_naive()
        folder.deleted_at = now
        folder.updated_at = now
        for entry in await self.repository.entries_in_folder(db, user_id, folder_id):
            if request.mode == FolderDeleteMode.TRASH_CONTENTS:
                entry.deleted_at = now
            else:
                entry.folder_id = None
            entry.updated_at = now
        await db.commit()

    async def list_entries(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        view: LibraryView,
        folder_id: str | None,
        search: str | None,
        sort: LibrarySort,
        page: int,
        page_size: int,
    ) -> tuple[list[LibraryEntryRead], int]:
        folder = await self._optional_folder(db, user_id, folder_id)
        selected_folder_id = (
            require_persisted_id(folder.id, entity="library folder") if folder else None
        )
        rows, total = await self.repository.list_entries(
            db,
            user_id,
            view=view,
            folder_id=selected_folder_id,
            search=search,
            sort=sort,
            page=page,
            page_size=page_size,
        )
        result = [
            await self._entry_read(db, entry, score, projection)
            for entry, score, projection in rows
        ]
        return result, total

    async def batch_move(
        self, db: AsyncSession, user_id: int, request: LibraryEntryBatchMoveRequest
    ) -> int:
        target = await self._optional_folder(db, user_id, request.target_folder_id)
        target_id = require_persisted_id(target.id, entity="library folder") if target else None
        moved = 0
        for entry_uuid in request.entry_ids:
            entry = await self.repository.entry_by_uuid(db, user_id, entry_uuid)
            if not entry:
                continue
            entry.folder_id = target_id
            entry.updated_at = utc_now_naive()
            moved += 1
        await db.commit()
        return moved

    async def batch_set_favorite(
        self, db: AsyncSession, user_id: int, request: LibraryEntryBatchUpdateRequest
    ) -> int:
        return await self._batch_update_entries(db, user_id, request.entry_ids, favorite=True)

    async def batch_trash(
        self, db: AsyncSession, user_id: int, request: LibraryEntryBatchUpdateRequest
    ) -> int:
        return await self._batch_update_entries(db, user_id, request.entry_ids, trash=True)

    async def batch_set_practice_state(
        self, db: AsyncSession, user_id: int, request: LibraryEntryBatchPracticeStateRequest
    ) -> int:
        return await self._batch_update_entries(
            db,
            user_id,
            request.entry_ids,
            practice_state=request.practice_state,
        )

    async def batch_add_owned_scores(
        self, db: AsyncSession, user_id: int, request: LibraryOwnedScoreBatchRequest
    ) -> int:
        changed = 0
        for score_uuid in request.score_ids:
            score = await self.score_repository.get(db, score_uuid)
            if not score or score.owner_user_id != user_id:
                continue
            score_id = require_persisted_id(score.id, entity="score")
            active_entry = await self.repository.entry(
                db,
                user_id,
                score_id,
                LibraryEntrySourceType.SELF_ADDED,
            )
            await self.ensure_entry(
                db,
                user_id=user_id,
                score_id=score_id,
                source_type=LibraryEntrySourceType.SELF_ADDED,
            )
            if active_entry is None:
                changed += 1
        await db.commit()
        return changed

    async def update_entry(
        self,
        db: AsyncSession,
        user_id: int,
        entry_uuid: str,
        request: LibraryEntryUpdateRequest,
    ) -> LibraryEntryRead:
        entry = await self.repository.entry_by_uuid(db, user_id, entry_uuid)
        if not entry:
            raise ResourceNotFoundException("library_entry", entry_uuid)
        if request.practice_state is not None:
            entry.practice_state = request.practice_state
        if request.is_favorite is not None:
            entry.is_favorite = request.is_favorite
        entry.updated_at = utc_now_naive()
        await db.commit()
        await db.refresh(entry)
        score = await db.get(Score, entry.score_id)
        if not score or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            raise ResourceNotFoundException("score", str(entry.score_id))
        projection = None
        if score.head_revision_id:
            projection = (
                await db.execute(
                    select(ScoreRevisionMetadata).where(
                        ScoreRevisionMetadata.revision_id == score.head_revision_id
                    )
                )
            ).scalar_one_or_none()
        return await self._entry_read(db, entry, score, projection)

    async def mark_practiced(self, db: AsyncSession, user_id: int, score_id: int) -> None:
        rows = await db.execute(
            select(ScoreLibraryEntry).where(
                ScoreLibraryEntry.user_id == user_id,
                ScoreLibraryEntry.score_id == score_id,
                col(ScoreLibraryEntry.deleted_at).is_(None),
            )
        )
        entries = list(rows.scalars().all())
        if not entries:
            return
        now = utc_now_naive()
        for entry in entries:
            entry.last_practiced_at = now
            if entry.practice_state == LibraryPracticeState.TO_PRACTICE:
                entry.practice_state = LibraryPracticeState.IN_PROGRESS
            entry.updated_at = now

    async def _entry_read(
        self,
        db: AsyncSession,
        entry: ScoreLibraryEntry,
        score: Score,
        projection,
    ) -> LibraryEntryRead:
        available = True
        try:
            await self.access_policy.authorize(
                db, score.score_uuid, ScoreAction.VIEW, user_id=entry.user_id
            )
        except UnauthorizedException:
            available = False
        head = (
            await db.get(ScoreRevision, score.head_revision_id) if score.head_revision_id else None
        )
        derived_assets = (
            await score_derived_assets(db, self.asset_repository, revision=head)
            if head
            else ScoreDerivedAssetsRead(
                preview=ScoreDerivedAssetRead(status="pending", asset_id=None),
                audio=ScoreDerivedAssetRead(status="pending", asset_id=None),
            )
        )
        return LibraryEntryRead(
            entry_id=entry.entry_uuid,
            score_id=score.score_uuid,
            source_type=entry.source_type,
            folder_id=await self._folder_uuid(db, entry.folder_id),
            title=score.title,
            derived_assets=derived_assets,
            genres=score.genres,
            metadata=(
                MetadataProjectionService.to_read(head, projection) if head and projection else None
            ),
            is_favorite=entry.is_favorite,
            practice_state=entry.practice_state,
            available=available,
            unavailable_reason=None if available else "access_unavailable",
            last_practiced_at=entry.last_practiced_at,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )

    async def _batch_update_entries(
        self,
        db: AsyncSession,
        user_id: int,
        entry_uuids: list[str],
        *,
        favorite: bool = False,
        trash: bool = False,
        practice_state: LibraryPracticeState | None = None,
    ) -> int:
        changed = 0
        now = utc_now_naive()
        for entry_uuid in entry_uuids:
            entry = await self.repository.entry_by_uuid(db, user_id, entry_uuid)
            if not entry:
                continue
            if favorite:
                entry.is_favorite = True
            if trash:
                entry.deleted_at = now
            if practice_state is not None:
                entry.practice_state = practice_state
            entry.updated_at = now
            changed += 1
        await db.commit()
        return changed

    async def _optional_folder(
        self, db: AsyncSession, user_id: int, folder_uuid: str | None
    ) -> ScoreLibraryFolder | None:
        if folder_uuid is None:
            return None
        folder = await self.repository.folder_by_uuid(db, user_id, folder_uuid)
        if not folder:
            raise ResourceNotFoundException("library_folder", folder_uuid)
        return folder

    async def _folder_read(
        self, db: AsyncSession, user_id: int, folder_uuid: str
    ) -> LibraryFolderRead:
        overview = await self.folder_overview(db, user_id)
        for folder in overview.folders:
            if folder.folder_id == folder_uuid:
                return folder
        raise ResourceNotFoundException("library_folder", folder_uuid)

    async def _folder_uuid(self, db: AsyncSession, folder_id: int | None) -> str | None:
        if folder_id is None:
            return None
        folder = await db.get(ScoreLibraryFolder, folder_id)
        return folder.folder_uuid if folder else None
