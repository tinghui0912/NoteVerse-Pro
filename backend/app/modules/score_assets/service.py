from __future__ import annotations

from dataclasses import dataclass
import io
import zipfile

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import FileException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import Score, ScoreRenderAsset, ScoreRevision, ScoreRevisionSource
from app.db.models.score import RenderAssetKind
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRecord, ScoreAssetRepository
from app.modules.score_assets.schemas import (
    AssetAccessRead,
    RenderAssetRead,
    RevisionSourceRead,
    ScoreRevisionAssetsRead,
)
from app.modules.scores.repository import ScoreRepository
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


@dataclass(frozen=True)
class ScoreAssetDelivery:
    filename: str
    media_type: str
    storage_key: str


class ScoreAssetService:
    def __init__(
        self,
        repository: ScoreAssetRepository | None = None,
        score_repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or ScoreAssetRepository()
        self.score_repository = score_repository or ScoreRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()

    async def list_revision_assets(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int | None,
        *,
        revision_uuid: str | None = None,
        include_sources: bool = True,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> ScoreRevisionAssetsRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            revision_uuid=revision_uuid,
            share_token=share_token,
            public_slug=public_slug,
        )
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        sources = (
            await self.repository.list_sources(db, revision_id)
            if include_sources
            else []
        )
        render_assets = await self.repository.list_render_assets(db, revision_id)
        return ScoreRevisionAssetsRead(
            revision_sources=[self._source_read(source, revision) for source in sources],
            render_assets=[
                self._render_asset_read(render_asset, revision)
                for render_asset in render_assets
            ],
        )

    async def source_delivery(
        self,
        db: AsyncSession,
        source_uuid: str,
        user_id: int | None,
        *,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> ScoreAssetDelivery:
        source, _revision = await self._authorized_source(
            db,
            source_uuid,
            user_id,
            ScoreAction.DOWNLOAD,
            share_token=share_token,
            public_slug=public_slug,
        )
        return self._delivery(source)

    async def render_asset_delivery(
        self,
        db: AsyncSession,
        render_asset_uuid: str,
        user_id: int | None,
        *,
        share_token: str | None = None,
        public_slug: str | None = None,
        download: bool = True,
    ) -> ScoreAssetDelivery:
        render_asset, _revision = await self._authorized_render_asset(
            db,
            render_asset_uuid,
            user_id,
            ScoreAction.DOWNLOAD if download else ScoreAction.VIEW,
            share_token=share_token,
            public_slug=public_slug,
        )
        return self._delivery(render_asset)

    async def source_access_url(
        self,
        db: AsyncSession,
        source_uuid: str,
        user_id: int | None,
    ) -> AssetAccessRead:
        source, _revision = await self._authorized_source(
            db,
            source_uuid,
            user_id,
            ScoreAction.DOWNLOAD,
        )
        return self._access_read(source, source.source_uuid, "revision-sources")

    async def render_asset_access_url(
        self,
        db: AsyncSession,
        render_asset_uuid: str,
        user_id: int | None,
    ) -> AssetAccessRead:
        render_asset, _revision = await self._authorized_render_asset(
            db,
            render_asset_uuid,
            user_id,
            ScoreAction.VIEW,
        )
        return self._access_read(render_asset, render_asset.asset_uuid, "render-assets")

    async def render_asset_archive(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int | None,
        *,
        revision_uuid: str | None = None,
        kind: RenderAssetKind,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> tuple[io.BytesIO, str]:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.DOWNLOAD,
            user_id=user_id,
            revision_uuid=revision_uuid,
            share_token=share_token,
            public_slug=public_slug,
        )
        render_assets = await self.repository.list_render_assets(
            db,
            require_persisted_id(access.revision.id, entity="score revision"),
            kind,
        )
        if not render_assets:
            raise ResourceNotFoundException("render_asset", score_uuid, ErrorCode.FILE_NOT_FOUND)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for render_asset in render_assets:
                self._require_object(render_asset)
                bundle.writestr(
                    render_asset.filename,
                    self.storage.read_bytes(render_asset.storage_key),
                )
        archive.seek(0)
        return archive, f"score-{score_uuid}-{kind.value.lower()}.zip"

    async def _authorized_source(
        self,
        db: AsyncSession,
        source_uuid: str,
        user_id: int | None,
        action: ScoreAction,
        *,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> tuple[ScoreRevisionSource, ScoreRevision]:
        source = await self.repository.get_source(db, source_uuid)
        if not source:
            raise ResourceNotFoundException("revision_source", source_uuid, ErrorCode.FILE_NOT_FOUND)
        revision = await self.repository.revision_for_asset(db, source)
        if not revision:
            raise ResourceNotFoundException("revision", source_uuid, ErrorCode.REVISION_NOT_FOUND)
        await self._authorize_asset_revision(
            db,
            revision,
            user_id,
            action,
            share_token=share_token,
            public_slug=public_slug,
        )
        return source, revision

    async def _authorized_render_asset(
        self,
        db: AsyncSession,
        render_asset_uuid: str,
        user_id: int | None,
        action: ScoreAction,
        *,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> tuple[ScoreRenderAsset, ScoreRevision]:
        render_asset = await self.repository.get_render_asset(db, render_asset_uuid)
        if not render_asset:
            raise ResourceNotFoundException("render_asset", render_asset_uuid, ErrorCode.FILE_NOT_FOUND)
        revision = await self.repository.revision_for_asset(db, render_asset)
        if not revision:
            raise ResourceNotFoundException("revision", render_asset_uuid, ErrorCode.REVISION_NOT_FOUND)
        await self._authorize_asset_revision(
            db,
            revision,
            user_id,
            action,
            share_token=share_token,
            public_slug=public_slug,
        )
        return render_asset, revision

    async def _authorize_asset_revision(
        self,
        db: AsyncSession,
        revision: ScoreRevision,
        user_id: int | None,
        action: ScoreAction,
        *,
        share_token: str | None,
        public_slug: str | None,
    ) -> None:
        score = await db.get(Score, revision.score_id)
        if not score:
            raise ResourceNotFoundException("score", revision.revision_uuid, ErrorCode.SCORE_NOT_FOUND)
        await self.access_policy.authorize(
            db,
            score.score_uuid,
            action,
            user_id=user_id,
            revision_uuid=revision.revision_uuid,
            share_token=share_token,
            public_slug=public_slug,
        )

    def _delivery(self, asset: ScoreAssetRecord) -> ScoreAssetDelivery:
        self._require_object(asset)
        return ScoreAssetDelivery(
            filename=asset.filename,
            media_type=asset.mime_type,
            storage_key=asset.storage_key,
        )

    def _access_read(
        self, asset: ScoreAssetRecord, asset_uuid: str, route_prefix: str
    ) -> AssetAccessRead:
        self._require_object(asset)
        return AssetAccessRead(
            asset_id=asset_uuid,
            url=f"{settings.API_V1_STR}/{route_prefix}/{asset_uuid}/download",
            filename=asset.filename,
            mime_type=asset.mime_type,
            expires_in=None,
        )

    def _require_object(self, asset: ScoreAssetRecord) -> None:
        if not self.storage.exists(asset.storage_key):
            raise FileException(ErrorCode.FILE_NOT_FOUND, asset.storage_key)

    def source_read(
        self, source: ScoreRevisionSource, revision: ScoreRevision
    ) -> RevisionSourceRead:
        return self._source_read(source, revision)

    def render_asset_read(
        self, render_asset: ScoreRenderAsset, revision: ScoreRevision
    ) -> RenderAssetRead:
        return self._render_asset_read(render_asset, revision)

    def _source_read(
        self, source: ScoreRevisionSource, revision: ScoreRevision
    ) -> RevisionSourceRead:
        return RevisionSourceRead(
            source_id=source.source_uuid,
            revision_id=revision.revision_uuid,
            format=source.format,
            filename=source.filename,
            mime_type=source.mime_type,
            size_bytes=source.size_bytes,
            created_at=source.created_at,
            available=self.storage.exists(source.storage_key),
        )

    def _render_asset_read(
        self, render_asset: ScoreRenderAsset, revision: ScoreRevision
    ) -> RenderAssetRead:
        return RenderAssetRead(
            render_asset_id=render_asset.asset_uuid,
            revision_id=revision.revision_uuid,
            kind=render_asset.kind,
            filename=render_asset.filename,
            mime_type=render_asset.mime_type,
            size_bytes=render_asset.size_bytes,
            page_number=render_asset.page_number,
            created_at=render_asset.created_at,
            available=self.storage.exists(render_asset.storage_key),
        )
