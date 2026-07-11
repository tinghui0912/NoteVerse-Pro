from __future__ import annotations

from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ImportJob,
    PlaybackAssetKind,
    PlaybackOutbox,
    RenderOutbox,
    Score,
    ScoreArtifact,
    ScorePlaybackAsset,
    ScorePublication,
    ScoreRevision,
    ScoreTaxonomyTag,
    TaxonomyCategory,
    TaxonomyTag,
)
from app.db.models.score_access import PublicationStatus
from app.modules.my_scores.schemas import MyScoresSort, MyScoresView
from app.db.models.score import ArtifactKind
from app.modules.scores.taxonomy import TAXONOMY_SORT_ORDER

score_title_col = Score.__table__.c.title
score_updated_col = Score.__table__.c.updated_at
class ScoreRepository:
    async def list_owned(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
        search: str | None = None,
        view: MyScoresView = MyScoresView.ALL,
        sort: MyScoresSort = MyScoresSort.UPDATED_DESC,
    ) -> tuple[list[Score], int]:
        filters = [Score.owner_user_id == user_id]
        if search:
            filters.append(score_title_col.ilike(f"%{search}%"))
        if view == MyScoresView.PUBLISHED:
            filters.append(
                select(ScorePublication.id)
                .where(
                    ScorePublication.score_id == Score.id,
                    ScorePublication.status == PublicationStatus.PUBLISHED,
                )
                .exists()
            )
        elif view == MyScoresView.PRIVATE:
            filters.append(
                ~select(ScorePublication.id)
                .where(
                    ScorePublication.score_id == Score.id,
                    ScorePublication.status == PublicationStatus.PUBLISHED,
                )
                .exists()
            )
        total = int(
            (
                await db.execute(select(func.count(Score.id)).where(*filters))
            ).scalar_one()
        )
        order_by = {
            MyScoresSort.UPDATED_DESC: [score_updated_col.desc()],
            MyScoresSort.UPDATED_ASC: [score_updated_col.asc()],
            MyScoresSort.NAME_ASC: [score_title_col.asc()],
            MyScoresSort.NAME_DESC: [score_title_col.desc()],
        }[sort]
        rows = await db.execute(
            select(Score)
            .where(*filters)
            .order_by(*order_by)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.scalars().all()), total
    async def get(self, db: AsyncSession, score_uuid: str, *, lock: bool = False) -> Score | None:
        statement = select(Score).where(Score.score_uuid == score_uuid)
        if lock:
            statement = statement.with_for_update()
        return (await db.execute(statement)).scalar_one_or_none()

    async def revision(self, db: AsyncSession, revision_uuid: str) -> ScoreRevision | None:
        return (
            await db.execute(
                select(ScoreRevision).where(ScoreRevision.revision_uuid == revision_uuid)
            )
        ).scalar_one_or_none()

    async def canonical_artifact(
        self, db: AsyncSession, revision_id: int
    ) -> ScoreArtifact | None:
        return (
            await db.execute(
                select(ScoreArtifact).where(
                    ScoreArtifact.revision_id == revision_id,
                    ScoreArtifact.kind == ArtifactKind.MUSICXML,
                )
            )
        ).scalar_one_or_none()

    async def first_rendered_page_artifact(
        self, db: AsyncSession, revision_id: int
    ) -> ScoreArtifact | None:
        return (
            await db.execute(
                select(ScoreArtifact)
                .where(
                    ScoreArtifact.revision_id == revision_id,
                    ScoreArtifact.kind == ArtifactKind.RENDERED_PAGE,
                )
                .order_by(ScoreArtifact.page_number.asc(), ScoreArtifact.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def latest_render_outbox(
        self, db: AsyncSession, revision_id: int, *, render_profile: str = "default"
    ) -> RenderOutbox | None:
        return (
            await db.execute(
                select(RenderOutbox)
                .where(
                    RenderOutbox.revision_id == revision_id,
                    RenderOutbox.render_profile == render_profile,
                )
                .order_by(RenderOutbox.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def playback_asset(
        self,
        db: AsyncSession,
        revision_id: int,
        *,
        kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> ScorePlaybackAsset | None:
        return (
            await db.execute(
                select(ScorePlaybackAsset)
                .where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == kind,
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    async def latest_playback_outbox(
        self,
        db: AsyncSession,
        revision_id: int,
        *,
        kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> PlaybackOutbox | None:
        return (
            await db.execute(
                select(PlaybackOutbox)
                .where(
                    PlaybackOutbox.revision_id == revision_id,
                    PlaybackOutbox.asset_kind == kind,
                )
                .order_by(PlaybackOutbox.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def fallback_rendered_page_artifact(
        self, db: AsyncSession, score_id: int, head_revision_id: int
    ) -> tuple[ScoreArtifact, ScoreRevision] | None:
        row = (
            await db.execute(
                select(ScoreArtifact, ScoreRevision)
                .join(ScoreRevision, ScoreArtifact.revision_id == ScoreRevision.id)
                .where(
                    ScoreRevision.score_id == score_id,
                    ScoreRevision.id != head_revision_id,
                    ScoreArtifact.kind == ArtifactKind.RENDERED_PAGE,
                )
                .order_by(
                    ScoreRevision.revision_number.desc(),
                    ScoreArtifact.page_number.asc(),
                    ScoreArtifact.created_at.asc(),
                )
                .limit(1)
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def originating_job(
        self, db: AsyncSession, job_id: int | None
    ) -> ImportJob | None:
        if job_id is None:
            return None
        return await db.get(ImportJob, job_id)

    async def publication(
        self, db: AsyncSession, score_id: int
    ) -> ScorePublication | None:
        return (
            await db.execute(
                select(ScorePublication).where(ScorePublication.score_id == score_id)
            )
        ).scalar_one_or_none()

    async def taxonomy_tags(
        self, db: AsyncSession, score_id: int
    ) -> list[tuple[str, str, str, float | None]]:
        rows = await db.execute(
            select(
                TaxonomyCategory.code,
                TaxonomyTag.code,
                ScoreTaxonomyTag.source,
                ScoreTaxonomyTag.confidence,
            )
            .join(TaxonomyTag, ScoreTaxonomyTag.tag_id == TaxonomyTag.id)
            .join(TaxonomyCategory, TaxonomyTag.category_id == TaxonomyCategory.id)
            .where(ScoreTaxonomyTag.score_id == score_id)
            .order_by(TaxonomyCategory.sort_order, TaxonomyTag.sort_order)
        )
        return list(rows.all())

    async def replace_taxonomy_tags(
        self,
        db: AsyncSession,
        score_id: int,
        tags: list[tuple[str, str]],
    ) -> None:
        await db.execute(delete(ScoreTaxonomyTag).where(ScoreTaxonomyTag.score_id == score_id))
        if not tags:
            return
        rows = await db.execute(
            select(TaxonomyCategory.code, TaxonomyTag.code, TaxonomyTag.id)
            .join(TaxonomyCategory, TaxonomyTag.category_id == TaxonomyCategory.id)
            .where(tuple_(TaxonomyCategory.code, TaxonomyTag.code).in_(tags))
            .where(TaxonomyCategory.is_active.is_(True), TaxonomyTag.is_active.is_(True))
        )
        tag_ids = {
            (category, code): tag_id
            for category, code, tag_id in rows.all()
        }
        missing = [
            f"{category}:{code}"
            for category, code in tags
            if (category, code) not in tag_ids
        ]
        if missing:
            raise ValueError(f"Taxonomy tags are not seeded: {', '.join(missing)}")
        for category, code in sorted(tags, key=lambda item: TAXONOMY_SORT_ORDER[item]):
            tag_id = tag_ids[(category, code)]
            db.add(ScoreTaxonomyTag(score_id=score_id, tag_id=tag_id, source="USER"))
