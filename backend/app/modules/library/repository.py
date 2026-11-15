from __future__ import annotations

from sqlalchemy import func, select, and_
from sqlalchemy.orm import Session
from sqlmodel import col
from app.db.models import Score, ScoreLibraryOrganization, ScoreLibraryFolder, ScoreRevisionMetadata
from app.modules.score_access.queries import accessible_score_predicate
from app.modules.library.schemas import LibrarySort, LibraryView


class LibraryRepository:
    def folder_by_uuid(
        self, db: Session, user_id: int, folder_uuid: str, *, lock: bool = False
    ) -> ScoreLibraryFolder | None:
        statement = select(ScoreLibraryFolder).where(
            ScoreLibraryFolder.user_id == user_id, ScoreLibraryFolder.folder_uuid == folder_uuid
        )
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return (db.execute(statement)).scalar_one_or_none()

    def folders(self, db: Session, user_id: int) -> list[ScoreLibraryFolder]:
        return list(
            (
                db.execute(
                    select(ScoreLibraryFolder)
                    .where(ScoreLibraryFolder.user_id == user_id)
                    .order_by(ScoreLibraryFolder.position, ScoreLibraryFolder.name)
                )
            )
            .scalars()
            .all()
        )

    def organization(
        self, db: Session, user_id: int, score_id: int
    ) -> ScoreLibraryOrganization | None:
        return (
            db.execute(
                select(ScoreLibraryOrganization).where(
                    ScoreLibraryOrganization.user_id == user_id,
                    ScoreLibraryOrganization.score_id == score_id,
                )
            )
        ).scalar_one_or_none()

    @staticmethod
    def _organization_join(user_id: int):
        return and_(
            ScoreLibraryOrganization.score_id == Score.id,
            ScoreLibraryOrganization.user_id == user_id,
        )

    def counts(self, db: Session, user_id: int) -> tuple[int, int, int, int, dict[int, int]]:
        rows = (
            db.execute(
                select(
                    Score.owner_user_id,
                    ScoreLibraryOrganization.folder_id,
                    ScoreLibraryOrganization.is_favorite,
                    func.count(Score.id),
                )
                .select_from(Score)
                .outerjoin(ScoreLibraryOrganization, self._organization_join(user_id))
                .where(accessible_score_predicate(user_id))
                .group_by(
                    Score.owner_user_id,
                    ScoreLibraryOrganization.folder_id,
                    ScoreLibraryOrganization.is_favorite,
                )
            )
        ).all()
        total = favorite = owned = shared = 0
        folders: dict[int, int] = {}
        for owner_id, folder_id, is_favorite, count in rows:
            total += count
            favorite += count if is_favorite else 0
            owned += count if owner_id == user_id else 0
            shared += count if owner_id != user_id else 0
            if folder_id is not None:
                folders[folder_id] = folders.get(folder_id, 0) + count
        return total, favorite, owned, shared, folders

    def list_scores(
        self,
        db: Session,
        user_id: int,
        *,
        view: LibraryView,
        folder_id: int | None,
        search: str | None,
        sort: LibrarySort,
        page: int,
        page_size: int,
    ) -> tuple[
        list[
            tuple[Score, ScoreLibraryOrganization | None, ScoreRevisionMetadata | None, str | None]
        ],
        int,
    ]:
        filters = [accessible_score_predicate(user_id)]
        if view == LibraryView.CREATED_BY_ME:
            filters.append(Score.__table__.c.owner_user_id == user_id)
        elif view == LibraryView.SHARED_WITH_ME:
            filters.append(Score.__table__.c.owner_user_id != user_id)
        elif view == LibraryView.FAVORITES:
            filters.append(col(ScoreLibraryOrganization.is_favorite).is_(True))
        if folder_id is not None:
            filters.append(ScoreLibraryOrganization.folder_id == folder_id)
        if search:
            filters.append(Score.__table__.c.title.ilike(f"%{search}%"))
        total = int(
            (
                db.execute(
                    select(func.count(Score.id))
                    .select_from(Score)
                    .outerjoin(ScoreLibraryOrganization, self._organization_join(user_id))
                    .where(*filters)
                )
            ).scalar_one()
        )
        order = {
            LibrarySort.UPDATED_ASC: Score.__table__.c.updated_at.asc(),
            LibrarySort.UPDATED_DESC: Score.__table__.c.updated_at.desc(),
            LibrarySort.NAME_ASC: Score.__table__.c.title.asc(),
            LibrarySort.NAME_DESC: Score.__table__.c.title.desc(),
        }[sort]
        rows = db.execute(
            select(
                Score,
                ScoreLibraryOrganization,
                ScoreRevisionMetadata,
                ScoreLibraryFolder.folder_uuid,
            )
            .outerjoin(ScoreLibraryOrganization, self._organization_join(user_id))
            .outerjoin(
                ScoreLibraryFolder,
                and_(
                    ScoreLibraryOrganization.folder_id == ScoreLibraryFolder.id,
                    ScoreLibraryFolder.user_id == user_id,
                ),
            )
            .outerjoin(
                ScoreRevisionMetadata, ScoreRevisionMetadata.revision_id == Score.head_revision_id
            )
            .where(*filters)
            .order_by(order, Score.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return [tuple(row) for row in rows.all()], total
