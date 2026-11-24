from __future__ import annotations
from sqlalchemy import delete
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import sqlite3
from app.core.exceptions import (
    ResourceAlreadyExistsException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreLibraryFolder, ScoreLibraryOrganization
from app.modules.library.repository import LibraryRepository
from app.modules.library.read_model import LibraryReadModel
from app.modules.library.schemas import (
    LibraryScoreBatchMoveRequest,
    LibraryScoreBatchFavoriteRequest,
    LibraryScoreRead,
    LibraryFolderCreateRequest,
    LibraryFolderUpdateRequest,
    LibraryFolderRead,
    LibraryFolderOverviewRead,
    LibrarySort,
    LibraryView,
)
from app.modules.score_assets.repository import ScoreAssetRepository
from app.shared.time import utc_now
from app.shared.error_codes import CustomerErrorCode


class LibraryService:
    def erase_user_state(self, db: Session, user_id: int) -> None:
        """Erase private organization after Account has removed owned graphs."""
        db.execute(
            delete(ScoreLibraryOrganization).where(ScoreLibraryOrganization.user_id == user_id)
        )
        db.execute(delete(ScoreLibraryFolder).where(ScoreLibraryFolder.user_id == user_id))

    def __init__(
        self,
        repository: LibraryRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
    ) -> None:
        self.repository = repository or LibraryRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()

    def folder_overview(self, db: Session, user_id: int) -> LibraryFolderOverviewRead:
        folders = self.repository.folders(db, user_id)
        total, favorites, owned, shared, counts = self.repository.counts(db, user_id)
        return LibraryFolderOverviewRead(
            all_count=total,
            favorite_count=favorites,
            created_by_me_count=owned,
            shared_with_me_count=shared,
            folders=[
                LibraryFolderRead(
                    folder_id=f.folder_uuid,
                    name=f.name,
                    position=f.position,
                    score_count=counts.get(require_persisted_id(f.id, entity="library folder"), 0),
                    created_at=f.created_at,
                    updated_at=f.updated_at,
                )
                for f in folders
            ],
        )

    def create_folder(
        self, db: Session, user_id: int, request: LibraryFolderCreateRequest
    ) -> LibraryFolderRead:
        now = utc_now()
        folder = ScoreLibraryFolder(
            user_id=user_id,
            name=request.name,
            created_at=now,
            updated_at=now,
        )
        db.add(folder)
        try:
            db.flush()
        except IntegrityError as exc:
            if duplicate_folder_name(exc):
                raise ResourceAlreadyExistsException("library_folder") from exc
            raise
        return self._folder_read(db, user_id, folder.folder_uuid)

    def update_folder(
        self,
        db: Session,
        user_id: int,
        folder_uuid: str,
        request: LibraryFolderUpdateRequest,
    ) -> LibraryFolderRead:
        folder = self.repository.folder_by_uuid(db, user_id, folder_uuid, lock=True)
        if not folder:
            raise ResourceNotFoundException("library_folder", folder_uuid)
        if request.name is not None:
            folder.name = request.name
        if request.position is not None:
            folder.position = request.position
        folder.updated_at = utc_now()
        try:
            db.flush()
        except IntegrityError as exc:
            if duplicate_folder_name(exc):
                raise ResourceAlreadyExistsException("library_folder") from exc
            raise
        return self._folder_read(db, user_id, folder.folder_uuid)

    def delete_folder(self, db: Session, user_id: int, folder_uuid: str) -> None:
        folder = self.repository.folder_by_uuid(db, user_id, folder_uuid, lock=True)
        if folder is None:
            raise ResourceNotFoundException("library_folder", folder_uuid)
        db.delete(folder)
        db.flush()

    def list_scores(
        self,
        db: Session,
        user_id: int,
        *,
        view: LibraryView,
        folder_id: str | None,
        search: str | None,
        sort: LibrarySort,
        page: int,
        page_size: int,
    ) -> tuple[list[LibraryScoreRead], int]:
        folder = self._optional_folder(db, user_id, folder_id)
        rows, total = self.repository.list_scores(
            db,
            user_id,
            view=view,
            folder_id=require_persisted_id(folder.id, entity="library folder") if folder else None,
            search=search,
            sort=sort,
            page=page,
            page_size=page_size,
        )
        return LibraryReadModel(self.asset_repository).score_page(db, user_id, rows), total

    def batch_move(self, db: Session, user_id: int, request: LibraryScoreBatchMoveRequest) -> int:
        folder = self._optional_folder(db, user_id, request.target_folder_id, lock=True)
        ids = self._mutation_score_ids(db, user_id, request.score_ids)
        rows = self.repository.upsert_organizations(
            db,
            user_id,
            ids,
            now=utc_now(),
            changes={
                "folder_id": require_persisted_id(folder.id, entity="library folder")
                if folder
                else None
            },
        )
        return len(rows)

    def batch_set_favorite(
        self, db: Session, user_id: int, request: LibraryScoreBatchFavoriteRequest
    ) -> int:
        ids = self._mutation_score_ids(db, user_id, request.score_ids)
        rows = self.repository.upsert_organizations(
            db,
            user_id,
            ids,
            now=utc_now(),
            changes={"is_favorite": request.is_favorite},
        )
        return len(rows)

    def _mutation_score_ids(self, db: Session, user_id: int, score_uuids: list[str]) -> list[int]:
        requested = sorted(set(score_uuids))
        # Preferences grant no access. Admission reads current access; later revocation or
        # deletion remains enforced by the Library read predicate, without Score row locks.
        rows = self.repository.mutation_scores(db, user_id, requested)
        found = {uuid for _, uuid, _ in rows}
        for uuid in requested:
            if uuid not in found:
                raise ResourceNotFoundException("score", uuid, CustomerErrorCode.SCORE_NOT_FOUND)
        for _, uuid, accessible in rows:
            if not accessible:
                raise UnauthorizedException(CustomerErrorCode.NO_ACCESS, {"score_id": uuid})
        return [identity for identity, _, _ in rows]

    def _optional_folder(
        self, db: Session, user_id: int, folder_uuid: str | None, *, lock: bool = False
    ) -> ScoreLibraryFolder | None:
        if folder_uuid is None:
            return None
        folder = self.repository.folder_by_uuid(db, user_id, folder_uuid, lock=lock)
        if folder is None:
            raise ResourceNotFoundException("library_folder", folder_uuid)
        return folder

    def _folder_read(self, db: Session, user_id: int, folder_uuid: str) -> LibraryFolderRead:
        for folder in (self.folder_overview(db, user_id)).folders:
            if folder.folder_id == folder_uuid:
                return folder
        raise ResourceNotFoundException("library_folder", folder_uuid)


def duplicate_folder_name(error: IntegrityError) -> bool:
    original = error.orig
    if getattr(original, "sqlstate", None) == "23505":
        return (
            getattr(getattr(original, "diag", None), "constraint_name", None)
            == "uq_score_library_folders_user_name"
        )
    return (
        getattr(original, "sqlite_errorcode", None) == sqlite3.SQLITE_CONSTRAINT_UNIQUE
        and str(original)
        == "UNIQUE constraint failed: score_library_folders.user_id, score_library_folders.name"
    )
