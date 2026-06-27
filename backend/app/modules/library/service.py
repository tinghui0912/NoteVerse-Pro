from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ResourceAlreadyExistsException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    LibraryEntrySourceType,
    LibraryPracticeState,
    Score,
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
    LibraryFolderTreeRead,
    LibraryFolderUpdateRequest,
    LibrarySort,
    LibraryView,
)
from app.modules.metadata.service import MetadataProjectionService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.schemas import ScoreTaxonomyTagRead
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class LibraryService:
    MAX_FOLDER_LEVEL = 2

    def __init__(
        self,
        repository: LibraryRepository | None = None,
        score_repository: ScoreRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or LibraryRepository()
        self.score_repository = score_repository or ScoreRepository()
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
        entry = await self.repository.entry(db, user_id, score_id, source_type)
        if entry:
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

    async def folder_tree(self, db: AsyncSession, user_id: int) -> LibraryFolderTreeRead:
        folders = await self.repository.folders(db, user_id)
        (
            all_count,
            favorite_count,
            recent_practice_count,
            to_practice_count,
            mastered_count,
            direct_counts,
        ) = await self.repository.counts(db, user_id)
        children: dict[int | None, list[ScoreLibraryFolder]] = {}
        for folder in folders:
            children.setdefault(folder.parent_folder_id, []).append(folder)

        def recursive_count(folder_id: int) -> int:
            total = direct_counts.get(folder_id, 0)
            for child in children.get(folder_id, []):
                child_id = require_persisted_id(child.id, entity="library folder")
                total += recursive_count(child_id)
            return total

        return LibraryFolderTreeRead(
            all_count=all_count,
            favorite_count=favorite_count,
            recent_practice_count=recent_practice_count,
            to_practice_count=to_practice_count,
            mastered_count=mastered_count,
            folders=[
                LibraryFolderRead(
                    folder_id=folder.folder_uuid,
                    parent_folder_id=(
                        self._folder_uuid_by_id(folders, folder.parent_folder_id)
                        if folder.parent_folder_id
                        else None
                    ),
                    name=folder.name,
                    position=folder.position,
                    direct_count=direct_counts.get(
                        require_persisted_id(folder.id, entity="library folder"),
                        0,
                    ),
                    recursive_count=recursive_count(
                        require_persisted_id(folder.id, entity="library folder")
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
        parent = await self._optional_folder(db, user_id, request.parent_folder_id)
        folders = await self.repository.folders(db, user_id)
        parent_id = (
            require_persisted_id(parent.id, entity="library folder")
            if parent
            else None
        )
        if self._folder_level(folders, parent_id) + 1 > self.MAX_FOLDER_LEVEL:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="parent_folder_id")
        now = utc_now_naive()
        folder = ScoreLibraryFolder(
            user_id=user_id,
            parent_folder_id=parent_id,
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
        folders = await self.repository.folders(db, user_id)
        folder_id = require_persisted_id(folder.id, entity="library folder")
        if request.name is not None:
            folder.name = request.name
        if request.position is not None:
            folder.position = request.position
        if "parent_folder_id" in request.model_fields_set:
            parent = await self._optional_folder(db, user_id, request.parent_folder_id)
            parent_id = require_persisted_id(parent.id, entity="library folder") if parent else None
            if parent_id == folder_id or parent_id in self._descendant_ids(folders, folder_id):
                raise ValidationException(ErrorCode.VALIDATION_ERROR, field="parent_folder_id")
            if (
                self._folder_level(folders, parent_id)
                + self._subtree_height(folders, folder_id)
                > self.MAX_FOLDER_LEVEL
            ):
                raise ValidationException(ErrorCode.VALIDATION_ERROR, field="parent_folder_id")
            folder.parent_folder_id = parent_id
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
        folders = await self.repository.folders(db, user_id)
        descendant_ids = self._descendant_ids(folders, folder_id)
        affected_folder_ids = {folder_id, *descendant_ids}
        target_parent_id = None
        if request.mode == FolderDeleteMode.MOVE_CONTENTS_TO_PARENT:
            target_parent_id = folder.parent_folder_id
        now = utc_now_naive()
        for child in folders:
            child_id = require_persisted_id(child.id, entity="library folder")
            if child_id in descendant_ids or child_id == folder_id:
                child.deleted_at = now
                child.updated_at = now
        for entry in await self.repository.entries_in_folder_ids(
            db, user_id, affected_folder_ids
        ):
            if request.mode == FolderDeleteMode.TRASH_CONTENTS:
                entry.deleted_at = now
            else:
                entry.folder_id = target_parent_id
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
        folder_ids = None
        if folder:
            folders = await self.repository.folders(db, user_id)
            selected_folder_id = require_persisted_id(folder.id, entity="library folder")
            folder_ids = {selected_folder_id, *self._descendant_ids(folders, selected_folder_id)}
        rows, total = await self.repository.list_entries(
            db,
            user_id,
            view=view,
            folder_ids=folder_ids,
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
        return await self._batch_update_entries(
            db, user_id, request.entry_ids, favorite=True
        )

    async def batch_trash(
        self, db: AsyncSession, user_id: int, request: LibraryEntryBatchUpdateRequest
    ) -> int:
        return await self._batch_update_entries(
            db, user_id, request.entry_ids, trash=True
        )

    async def batch_set_practice_state(
        self, db: AsyncSession, user_id: int, request: LibraryEntryBatchPracticeStateRequest
    ) -> int:
        return await self._batch_update_entries(
            db,
            user_id,
            request.entry_ids,
            practice_state=request.practice_state,
        )

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
        if not score:
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
                ScoreLibraryEntry.deleted_at.is_(None),
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
        head = await db.get(ScoreRevision, score.head_revision_id) if score.head_revision_id else None
        score_id = require_persisted_id(score.id, entity="score")
        thumbnail = (
            await self.score_repository.first_rendered_page_artifact(db, score.head_revision_id)
            if score.head_revision_id
            else None
        )
        return LibraryEntryRead(
            entry_id=entry.entry_uuid,
            score_id=score.score_uuid,
            source_type=entry.source_type,
            folder_id=await self._folder_uuid(db, entry.folder_id),
            title=score.title,
            score_state=score.state,
            thumbnail_artifact_id=thumbnail.artifact_uuid if thumbnail else None,
            taxonomy_tags=[
                ScoreTaxonomyTagRead(
                    category=category,
                    code=code,
                    source=source,
                    confidence=confidence,
                )
                for category, code, source, confidence in await self.score_repository.taxonomy_tags(
                    db, score_id
                )
            ],
            metadata=(
                MetadataProjectionService.to_read(head, projection)
                if head and projection
                else None
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
        tree = await self.folder_tree(db, user_id)
        for folder in tree.folders:
            if folder.folder_id == folder_uuid:
                return folder
        raise ResourceNotFoundException("library_folder", folder_uuid)

    async def _folder_uuid(self, db: AsyncSession, folder_id: int | None) -> str | None:
        if folder_id is None:
            return None
        folder = await db.get(ScoreLibraryFolder, folder_id)
        return folder.folder_uuid if folder else None

    @staticmethod
    def _folder_uuid_by_id(
        folders: list[ScoreLibraryFolder], folder_id: int | None
    ) -> str | None:
        if folder_id is None:
            return None
        for folder in folders:
            if folder.id == folder_id:
                return folder.folder_uuid
        return None

    @staticmethod
    def _descendant_ids(folders: list[ScoreLibraryFolder], folder_id: int) -> set[int]:
        children: dict[int | None, list[ScoreLibraryFolder]] = {}
        for folder in folders:
            children.setdefault(folder.parent_folder_id, []).append(folder)
        result: set[int] = set()

        def visit(parent_id: int) -> None:
            for child in children.get(parent_id, []):
                child_id = require_persisted_id(child.id, entity="library folder")
                result.add(child_id)
                visit(child_id)

        visit(folder_id)
        return result

    @staticmethod
    def _folder_level(folders: list[ScoreLibraryFolder], folder_id: int | None) -> int:
        if folder_id is None:
            return 0
        level = 1
        by_id = {
            require_persisted_id(folder.id, entity="library folder"): folder
            for folder in folders
        }
        current = by_id.get(folder_id)
        seen = {folder_id}
        while current and current.parent_folder_id is not None:
            parent_id = current.parent_folder_id
            if parent_id in seen:
                break
            seen.add(parent_id)
            level += 1
            current = by_id.get(parent_id)
        return level

    @classmethod
    def _subtree_height(cls, folders: list[ScoreLibraryFolder], folder_id: int) -> int:
        children: dict[int | None, list[ScoreLibraryFolder]] = {}
        for folder in folders:
            children.setdefault(folder.parent_folder_id, []).append(folder)

        def visit(parent_id: int) -> int:
            child_heights = [
                visit(require_persisted_id(child.id, entity="library folder"))
                for child in children.get(parent_id, [])
            ]
            return 1 + (max(child_heights) if child_heights else 0)

        return visit(folder_id)

