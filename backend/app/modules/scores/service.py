from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictException,
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportJob,
    ImportJobUpload,
    PracticeSession,
    Score,
    ScoreInputAsset,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreRevisionSource,
    StorageBlob,
    StorageUsageCategory,
    Upload,
)
from app.modules.score_assets.derived_assets import score_derived_assets
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.schemas import ScoreDerivedAssetRead, ScoreDerivedAssetsRead
from app.modules.scores.repository import ScoreRepository
from app.modules.my_scores.schemas import MyScoresSort, MyScoresView
from app.modules.scores.schemas import (
    ScoreInputAssetRead,
    ScoreRead,
    ScorePublicationSummaryRead,
    ScoreTaxonomyTagRead,
    ScoreUpdateRequest,
)
from app.modules.metadata.service import MetadataProjectionService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_assets.render_service import RevisionRenderService
from app.modules.import_jobs.service import ImportJobService
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class ScoreInputAssetDelivery:
    filename: str
    media_type: str
    path: str | None = None
    redirect_url: str | None = None


class ScoreService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        render_service: RevisionRenderService | None = None,
        asset_repository: ScoreAssetRepository | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.render_service = render_service or RevisionRenderService(
            access_policy=self.access_policy,
            storage=self.storage,
        )

    async def get(self, db: AsyncSession, score_uuid: str, user_id: int) -> ScoreRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.VIEW, user_id=user_id
        )
        return await self._read(db, access.score, access.capabilities)

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
    ) -> tuple[list[ScoreRead], int]:
        rows, total = await self.repository.list_owned(
            db,
            user_id,
            page=page,
            page_size=page_size,
            search=search,
            view=view,
            sort=sort,
        )
        result: list[ScoreRead] = []
        for score in rows:
            access = await self.access_policy.authorize(
                db, score.score_uuid, ScoreAction.VIEW, user_id=user_id
            )
            result.append(await self._read(db, score, access.capabilities))
        return result, total

    async def batch_delete(
        self, db: AsyncSession, score_uuids: list[str], user_id: int
    ) -> int:
        removed = 0
        for score_uuid in score_uuids:
            try:
                await self.delete(db, score_uuid, user_id)
            except (ResourceNotFoundException, UnauthorizedException):
                continue
            removed += 1
        return removed

    async def update(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        request: ScoreUpdateRequest,
    ) -> ScoreRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        if score.version != request.expected_version:
            raise ConflictException(
                ErrorCode.REVISION_CONFLICT,
                {"expected_version": request.expected_version, "actual_version": score.version},
            )
        if request.title is not None:
            score.title = request.title.strip()
        if request.taxonomy_tags is not None:
            score_id = require_persisted_id(score.id, entity="score")
            await self.repository.replace_taxonomy_tags(
                db,
                score_id,
                [(tag.category, tag.code) for tag in request.taxonomy_tags],
            )
        score.version += 1
        score.updated_at = utc_now_naive()
        await db.commit()
        await db.refresh(score)
        return await self._read(db, score, access.capabilities)

    async def delete(self, db: AsyncSession, score_uuid: str, user_id: int) -> None:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.DELETE, user_id=user_id
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        score_id = require_persisted_id(score.id, entity="score")
        owner_user_id = score.owner_user_id
        originating_job_uuid = await self._single_score_originating_job_uuid(
            db,
            score_id=score_id,
            originating_job_id=score.originating_job_id,
        )
        usage_releases: list[tuple[StorageUsageCategory, int, str, str, str]] = []
        keys = list(
            (
                await db.execute(
                    select(
                        ScoreRevisionSource.source_uuid,
                        ScoreRevisionSource.storage_key,
                        ScoreRevisionSource.size_bytes,
                    )
                    .join(
                        ScoreRevision,
                        ScoreRevisionSource.revision_id == ScoreRevision.id,
                    )
                    .where(ScoreRevision.score_id == score_id)
                )
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.SOURCE,
                size_bytes,
                "score_revision_source",
                source_uuid,
                storage_key,
            )
            for source_uuid, storage_key, size_bytes in keys
        )
        storage_keys = [storage_key for _, storage_key, _ in keys]
        render_rows = list(
            (
                await db.execute(
                    select(
                        ScoreRenderAsset.asset_uuid,
                        ScoreRenderAsset.storage_key,
                        ScoreRenderAsset.size_bytes,
                    )
                    .join(ScoreRevision, ScoreRenderAsset.revision_id == ScoreRevision.id)
                    .where(ScoreRevision.score_id == score_id)
                )
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.DERIVED_RENDER,
                size_bytes,
                "score_render_asset",
                asset_uuid,
                storage_key,
            )
            for asset_uuid, storage_key, size_bytes in render_rows
        )
        storage_keys.extend(storage_key for _, storage_key, _ in render_rows)
        audio_rows = list(
            (
                await db.execute(
                    select(
                        ScorePlaybackAsset.asset_uuid,
                        ScorePlaybackAsset.storage_key,
                        ScorePlaybackAsset.size_bytes,
                    )
                    .join(ScoreRevision, ScorePlaybackAsset.revision_id == ScoreRevision.id)
                    .where(ScoreRevision.score_id == score_id)
                )
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.DERIVED_AUDIO,
                size_bytes,
                "score_playback_asset",
                asset_uuid,
                storage_key,
            )
            for asset_uuid, storage_key, size_bytes in audio_rows
        )
        storage_keys.extend(storage_key for _, storage_key, _ in audio_rows)
        input_rows = list(
            (
                await db.execute(
                    select(
                        ScoreInputAsset.asset_uuid,
                        ScoreInputAsset.upload_id,
                        StorageBlob.id,
                        StorageBlob.blob_uuid,
                        StorageBlob.storage_key,
                        StorageBlob.size_bytes,
                    )
                    .join(Upload, ScoreInputAsset.upload_id == Upload.id)
                    .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                    .where(ScoreInputAsset.score_id == score_id)
                )
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.INPUT_ASSET,
                size_bytes,
                "score_input_asset",
                asset_uuid,
                storage_key,
            )
            for asset_uuid, _upload_id, _blob_id, _blob_uuid, storage_key, size_bytes in input_rows
        )
        upload_ids_to_maybe_delete = [upload_id for _asset_uuid, upload_id, *_rest in input_rows]
        blob_rows_by_upload = {
            upload_id: (blob_id, blob_uuid, storage_key)
            for _asset_uuid, upload_id, blob_id, blob_uuid, storage_key, _size_bytes in input_rows
        }
        score.head_revision_id = None
        await db.execute(sa_delete(PracticeSession).where(PracticeSession.score_id == score_id))
        await db.flush()
        await db.delete(score)
        await db.flush()
        blobs_to_delete: dict[int, tuple[str, str]] = {}
        for upload_id in upload_ids_to_maybe_delete:
            import_refs = (
                await db.execute(
                    select(func.count(ImportJobUpload.id)).where(ImportJobUpload.upload_id == upload_id)
                )
            ).scalar_one()
            input_refs = (
                await db.execute(
                    select(func.count(ScoreInputAsset.id)).where(ScoreInputAsset.upload_id == upload_id)
                )
            ).scalar_one()
            if import_refs or input_refs:
                continue
            upload = await db.get(Upload, upload_id)
            if upload is None:
                continue
            blob_id, blob_uuid, blob_storage_key = blob_rows_by_upload[upload_id]
            await db.delete(upload)
            blob_refs = (
                await db.execute(select(func.count(Upload.id)).where(Upload.blob_id == blob_id))
            ).scalar_one()
            if blob_refs <= 1:
                blob = await db.get(StorageBlob, blob_id)
                if blob is not None:
                    await db.delete(blob)
                    blobs_to_delete[blob_id] = (blob_uuid, blob_storage_key)
        await db.commit()
        for category, size_bytes, object_type, object_id, storage_key in usage_releases:
            await storage_usage_service.record_release(
                db,
                user_id=owner_user_id,
                category=category,
                bytes_count=size_bytes,
                reason="delete_score",
                object_type=object_type,
                object_id=object_id,
                storage_key=storage_key,
            )
        for key in storage_keys:
            try:
                self.storage.delete(key)
            except Exception:
                # Database deletion is authoritative; orphan cleanup retries storage removal.
                pass
        for _blob_uuid, blob_storage_key in blobs_to_delete.values():
            try:
                self.storage.delete(blob_storage_key)
            except Exception:
                pass
        if originating_job_uuid is not None:
            await ImportJobService(storage=self.storage).delete(
                db,
                originating_job_uuid,
                owner_user_id,
            )

    async def input_asset_delivery(
        self,
        db: AsyncSession,
        score_uuid: str,
        asset_uuid: str,
        user_id: int,
    ) -> ScoreInputAssetDelivery:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.VIEW, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        row = (
            await db.execute(
                select(ScoreInputAsset, Upload, StorageBlob)
                .join(Upload, ScoreInputAsset.upload_id == Upload.id)
                .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                .where(
                    ScoreInputAsset.score_id == score_id,
                    ScoreInputAsset.asset_uuid == asset_uuid,
                )
            )
        ).first()
        if row is None:
            raise ResourceNotFoundException("score_input_asset", asset_uuid, ErrorCode.FILE_NOT_FOUND)
        _asset, upload, blob = row
        if not self.storage.exists(blob.storage_key):
            raise FileException(ErrorCode.FILE_NOT_FOUND, blob.storage_key)
        filename = upload.original_filename or blob.filename
        if self.storage.backend_name != "local":
            url = self.storage.download_url(
                blob.storage_key,
                filename=filename,
                content_type=blob.mime_type,
            )
            if not url:
                raise FileException(ErrorCode.FILE_NOT_FOUND, blob.storage_key)
            return ScoreInputAssetDelivery(
                filename=filename,
                media_type=blob.mime_type,
                redirect_url=url,
            )
        return ScoreInputAssetDelivery(
            filename=filename,
            media_type=blob.mime_type,
            path=self.storage.materialize_to_local(
                blob.storage_key,
                self.storage.local_path(blob.storage_key),
            ),
        )

    async def _single_score_originating_job_uuid(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        originating_job_id: int | None,
    ) -> str | None:
        if originating_job_id is None:
            return None
        sibling_count = (
            await db.execute(
                select(func.count(Score.id)).where(
                    Score.originating_job_id == originating_job_id,
                    Score.id != score_id,
                )
            )
        ).scalar_one()
        if sibling_count:
            return None
        job = await db.get(ImportJob, originating_job_id)
        return job.job_uuid if job is not None else None

    async def _read(
        self,
        db: AsyncSession,
        score: Score,
        capabilities: ScoreCapabilities,
    ) -> ScoreRead:
        head = await db.get(ScoreRevision, score.head_revision_id) if score.head_revision_id else None
        job = await self.repository.originating_job(db, score.originating_job_id)
        projection = (
            await db.get(ScoreRevisionMetadata, score.head_revision_id)
            if score.head_revision_id
            else None
        )
        score_id = require_persisted_id(score.id, entity="score")
        derived_assets = (
            await score_derived_assets(
                db, self.asset_repository, score_id=score_id, revision=head
            )
            if head
            else ScoreDerivedAssetsRead(
                preview=ScoreDerivedAssetRead(),
                audio=ScoreDerivedAssetRead(),
            )
        )
        publication = await self.repository.publication(db, score_id)
        input_asset_rows = (
            await db.execute(
                select(ScoreInputAsset, Upload, StorageBlob)
                .join(Upload, ScoreInputAsset.upload_id == Upload.id)
                .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                .where(ScoreInputAsset.score_id == score_id)
                .order_by(ScoreInputAsset.sort_order.asc(), ScoreInputAsset.id.asc())
            )
        ).all()
        published_revision = (
            await db.get(ScoreRevision, publication.published_revision_id)
            if publication
            else None
        )
        return ScoreRead(
            score_id=score.score_uuid,
            title=score.title,
            taxonomy_tags=[
                ScoreTaxonomyTagRead(
                    category=category,
                    code=code,
                    source=source,
                    confidence=confidence,
                )
                for category, code, source, confidence in await self.repository.taxonomy_tags(db, score_id)
            ],
            version=score.version,
            head_revision_id=head.revision_uuid if head else None,
            derived_assets=derived_assets,
            input_assets=[
                ScoreInputAssetRead(
                    asset_id=asset.asset_uuid,
                    filename=upload.original_filename or blob.filename,
                    mime_type=blob.mime_type,
                    size=blob.size_bytes,
                    sha256=blob.sha256,
                    page_number=asset.page_number,
                )
                for asset, upload, blob in input_asset_rows
            ],
            publication=(
                ScorePublicationSummaryRead(
                    public_slug=publication.public_slug,
                    revision_id=published_revision.revision_uuid,
                    status=publication.status,
                )
                if publication and published_revision
                else None
            ),
            originating_job_id=job.job_uuid if job else None,
            metadata=(
                MetadataProjectionService.to_read(head, projection)
                if head and projection
                else None
            ),
            capabilities=capabilities,
            created_at=score.created_at,
            updated_at=score.updated_at,
        )
