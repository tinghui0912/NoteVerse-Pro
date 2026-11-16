from __future__ import annotations
from sqlalchemy.orm import Session
from app.core.exceptions import ResourceAlreadyExistsException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreLibraryOrganization, ScoreLibraryFolder, ScoreRevision
from app.db.models.score_access import AccessOrigin
from app.modules.library.repository import LibraryRepository
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
from app.modules.metadata.service import MetadataProjectionService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.derived_assets import score_derived_assets
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.schemas import ScoreDerivedAssetRead, ScoreDerivedAssetsRead
from app.modules.scores.repository import ScoreRepository
from app.shared.time import utc_now


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
            db.commit()
        except Exception as exc:
            db.rollback()
            raise ResourceAlreadyExistsException("library_folder") from exc
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
            db.commit()
        except Exception as exc:
            db.rollback()
            raise ResourceAlreadyExistsException("library_folder") from exc
        return self._folder_read(db, user_id, folder.folder_uuid)

    def delete_folder(self, db: Session, user_id: int, folder_uuid: str) -> None:
        folder = self.repository.folder_by_uuid(db, user_id, folder_uuid, lock=True)
        if folder is None:
            raise ResourceNotFoundException("library_folder", folder_uuid)
        db.delete(folder)
        db.commit()

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
        result = []
        for score, organization, projection, folder_uuid in rows:
            head = db.get(ScoreRevision, score.head_revision_id) if score.head_revision_id else None
            assets = (
                score_derived_assets(db, self.asset_repository, revision=head)
                if head
                else ScoreDerivedAssetsRead(
                    preview=ScoreDerivedAssetRead(status="pending", asset_id=None),
                    audio=ScoreDerivedAssetRead(status="pending", asset_id=None),
                )
            )
            result.append(
                LibraryScoreRead(
                    score_id=score.score_uuid,
                    access_origin=AccessOrigin.OWNER
                    if score.owner_user_id == user_id
                    else AccessOrigin.MEMBERSHIP,
                    folder_id=folder_uuid,
                    display_title=score.display_title,
                    genres=score.genres,
                    derived_assets=assets,
                    metadata=MetadataProjectionService.to_read(head, projection)
                    if head and projection
                    else None,
                    is_favorite=organization.is_favorite if organization else False,
                    created_at=score.created_at,
                    updated_at=score.updated_at,
                )
            )
        return result, total

    def batch_move(self, db: Session, user_id: int, request: LibraryScoreBatchMoveRequest) -> int:
        try:
            folder = self._optional_folder(db, user_id, request.target_folder_id, lock=True)
            rows = self._organizations_for_mutation(db, user_id, request.score_ids)
            for row in rows:
                row.folder_id = (
                    require_persisted_id(folder.id, entity="library folder") if folder else None
                )
                row.updated_at = utc_now()
            db.commit()
            return len(rows)
        except Exception:
            db.rollback()
            raise

    def batch_set_favorite(
        self, db: Session, user_id: int, request: LibraryScoreBatchFavoriteRequest
    ) -> int:
        try:
            rows = self._organizations_for_mutation(db, user_id, request.score_ids)
            for row in rows:
                row.is_favorite = request.is_favorite
                row.updated_at = utc_now()
            db.commit()
            return len(rows)
        except Exception:
            db.rollback()
            raise

    def _organizations_for_mutation(
        self, db: Session, user_id: int, score_uuids: list[str]
    ) -> list[ScoreLibraryOrganization]:
        rows = []
        for uuid in sorted(set(score_uuids)):
            self.access_policy.authorize_score(db, uuid, ScoreAction.VIEW, user_id=user_id)
            score = self.score_repository.get(db, uuid, lock=True)
            if score is None:
                raise ResourceNotFoundException("score", uuid)
            score_id = require_persisted_id(score.id, entity="score")
            row = self.repository.organization(db, user_id, score_id)
            if row is None:
                row = ScoreLibraryOrganization(user_id=user_id, score_id=score_id)
                db.add(row)
            rows.append(row)
        return rows

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
