from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    LibraryEntrySourceType,
    LibraryPracticeState,
    Score,
    ScoreLibraryEntry,
    ScoreLibraryFolder,
    ScoreRevisionMetadata,
)
from app.modules.library.schemas import LibrarySort, LibraryView

entry_updated_col = ScoreLibraryEntry.__table__.c.updated_at
score_title_col = Score.__table__.c.title


class LibraryRepository:
    async def folder_by_uuid(
        self, db: AsyncSession, user_id: int, folder_uuid: str, *, lock: bool = False
    ) -> ScoreLibraryFolder | None:
        statement = select(ScoreLibraryFolder).where(
            ScoreLibraryFolder.user_id == user_id,
            ScoreLibraryFolder.folder_uuid == folder_uuid,
            ScoreLibraryFolder.deleted_at.is_(None),
        )
        if lock:
            statement = statement.with_for_update()
        return (await db.execute(statement)).scalar_one_or_none()

    async def folders(self, db: AsyncSession, user_id: int) -> list[ScoreLibraryFolder]:
        rows = await db.execute(
            select(ScoreLibraryFolder)
            .where(
                ScoreLibraryFolder.user_id == user_id,
                ScoreLibraryFolder.deleted_at.is_(None),
            )
            .order_by(ScoreLibraryFolder.position, ScoreLibraryFolder.name)
        )
        return list(rows.scalars().all())

    async def folder_children(
        self, db: AsyncSession, user_id: int, parent_id: int | None
    ) -> list[ScoreLibraryFolder]:
        rows = await db.execute(
            select(ScoreLibraryFolder).where(
                ScoreLibraryFolder.user_id == user_id,
                ScoreLibraryFolder.parent_folder_id == parent_id,
                ScoreLibraryFolder.deleted_at.is_(None),
            )
        )
        return list(rows.scalars().all())

    async def entry_by_uuid(
        self, db: AsyncSession, user_id: int, entry_uuid: str
    ) -> ScoreLibraryEntry | None:
        return (
            await db.execute(
                select(ScoreLibraryEntry).where(
                    ScoreLibraryEntry.user_id == user_id,
                    ScoreLibraryEntry.entry_uuid == entry_uuid,
                    ScoreLibraryEntry.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    async def entry(
        self,
        db: AsyncSession,
        user_id: int,
        score_id: int,
        source_type: LibraryEntrySourceType,
    ) -> ScoreLibraryEntry | None:
        return (
            await db.execute(
                select(ScoreLibraryEntry).where(
                    ScoreLibraryEntry.user_id == user_id,
                    ScoreLibraryEntry.score_id == score_id,
                    ScoreLibraryEntry.source_type == source_type,
                    ScoreLibraryEntry.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    async def counts(
        self, db: AsyncSession, user_id: int
    ) -> tuple[int, int, int, int, int, dict[int, int]]:
        total = int(
            (
                await db.execute(
                    select(func.count(ScoreLibraryEntry.id)).where(
                        ScoreLibraryEntry.user_id == user_id,
                        ScoreLibraryEntry.deleted_at.is_(None),
                    )
                )
            ).scalar_one()
        )
        favorite = int(
            (
                await db.execute(
                    select(func.count(ScoreLibraryEntry.id)).where(
                        ScoreLibraryEntry.user_id == user_id,
                        ScoreLibraryEntry.deleted_at.is_(None),
                        ScoreLibraryEntry.is_favorite.is_(True),
                    )
                )
            ).scalar_one()
        )
        recent_practice = int(
            (
                await db.execute(
                    select(func.count(ScoreLibraryEntry.id)).where(
                        ScoreLibraryEntry.user_id == user_id,
                        ScoreLibraryEntry.deleted_at.is_(None),
                        ScoreLibraryEntry.last_practiced_at.is_not(None),
                    )
                )
            ).scalar_one()
        )
        to_practice = int(
            (
                await db.execute(
                    select(func.count(ScoreLibraryEntry.id)).where(
                        ScoreLibraryEntry.user_id == user_id,
                        ScoreLibraryEntry.deleted_at.is_(None),
                        ScoreLibraryEntry.practice_state == LibraryPracticeState.TO_PRACTICE,
                    )
                )
            ).scalar_one()
        )
        mastered = int(
            (
                await db.execute(
                    select(func.count(ScoreLibraryEntry.id)).where(
                        ScoreLibraryEntry.user_id == user_id,
                        ScoreLibraryEntry.deleted_at.is_(None),
                        ScoreLibraryEntry.practice_state == LibraryPracticeState.MASTERED,
                    )
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(ScoreLibraryEntry.folder_id, func.count(ScoreLibraryEntry.id))
            .where(
                ScoreLibraryEntry.user_id == user_id,
                ScoreLibraryEntry.deleted_at.is_(None),
                ScoreLibraryEntry.folder_id.is_not(None),
            )
            .group_by(ScoreLibraryEntry.folder_id)
        )
        return (
            total,
            favorite,
            recent_practice,
            to_practice,
            mastered,
            {int(folder_id): int(count) for folder_id, count in rows.all()},
        )

    async def list_entries(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        view: LibraryView,
        folder_ids: set[int] | None,
        search: str | None,
        sort: LibrarySort,
        page: int,
        page_size: int,
    ) -> tuple[list[tuple[ScoreLibraryEntry, Score, ScoreRevisionMetadata | None]], int]:
        filters = [ScoreLibraryEntry.user_id == user_id]
        if view == LibraryView.TRASH:
            filters.append(ScoreLibraryEntry.deleted_at.is_not(None))
        else:
            filters.append(ScoreLibraryEntry.deleted_at.is_(None))
        if view == LibraryView.FAVORITES:
            filters.append(ScoreLibraryEntry.is_favorite.is_(True))
        elif view == LibraryView.RECENT_PRACTICE:
            filters.append(ScoreLibraryEntry.last_practiced_at.is_not(None))
            sort = LibrarySort.PRACTICED_DESC
        elif view == LibraryView.TO_PRACTICE:
            filters.append(ScoreLibraryEntry.practice_state == LibraryPracticeState.TO_PRACTICE)
        elif view == LibraryView.MASTERED:
            filters.append(ScoreLibraryEntry.practice_state == LibraryPracticeState.MASTERED)
        elif view == LibraryView.BOOKMARKS:
            filters.append(ScoreLibraryEntry.source_type == LibraryEntrySourceType.BOOKMARK)
        if folder_ids is not None:
            filters.append(ScoreLibraryEntry.folder_id.in_(folder_ids))
        if search:
            filters.append(score_title_col.ilike(f"%{search}%"))

        total = int(
            (
                await db.execute(
                    select(func.count(ScoreLibraryEntry.id))
                    .join(Score, Score.id == ScoreLibraryEntry.score_id)
                    .where(*filters)
                )
            ).scalar_one()
        )
        order_by = {
            LibrarySort.UPDATED_ASC: [entry_updated_col.asc()],
            LibrarySort.UPDATED_DESC: [entry_updated_col.desc()],
            LibrarySort.NAME_ASC: [score_title_col.asc()],
            LibrarySort.NAME_DESC: [score_title_col.desc()],
            LibrarySort.PRACTICED_DESC: [ScoreLibraryEntry.last_practiced_at.desc().nullslast(), entry_updated_col.desc()],
        }[sort]
        rows = await db.execute(
            select(ScoreLibraryEntry, Score, ScoreRevisionMetadata)
            .join(Score, Score.id == ScoreLibraryEntry.score_id)
            .outerjoin(ScoreRevisionMetadata, ScoreRevisionMetadata.revision_id == Score.head_revision_id)
            .where(*filters)
            .order_by(*order_by)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.all()), total

    async def entries_in_folder_ids(
        self, db: AsyncSession, user_id: int, folder_ids: set[int]
    ) -> list[ScoreLibraryEntry]:
        if not folder_ids:
            return []
        rows = await db.execute(
            select(ScoreLibraryEntry).where(
                ScoreLibraryEntry.user_id == user_id,
                ScoreLibraryEntry.deleted_at.is_(None),
                ScoreLibraryEntry.folder_id.in_(folder_ids),
            )
        )
        return list(rows.scalars().all())

