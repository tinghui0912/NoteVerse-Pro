from __future__ import annotations

from app.modules.media_storage.delivery import MediaDeliveryService
from app.modules.media_storage.reads import (
    StoredObjectDelivery,
    StoredObjectReadTarget,
    read_admitted_bytes,
)

import io
import zipfile

from sqlalchemy.orm import Session

from app.core.generated.customer_browser_protocol import CUSTOMER_API_PREFIX
from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRenderAsset, ScoreRevision, ScoreRevisionSource
from app.modules.score_assets.domain import RenderAssetKind
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.score_assets.repository import ScoreAssetRecord, ScoreAssetRepository
from app.modules.score_assets.schemas import (
    AssetAccessRead,
    RenderAssetRead,
    RevisionSourceRead,
    ScoreRevisionAssetsRead,
)
from app.modules.scores.repository import ScoreRepository
from app.shared.error_codes import CustomerErrorCode


class ScoreAssetService:
    def __init__(
        self,
        repository: ScoreAssetRepository | None = None,
        score_repository: ScoreRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        *,
        delivery: MediaDeliveryService,
    ) -> None:
        self.delivery = delivery
        self.repository = repository or ScoreAssetRepository()
        self.score_repository = score_repository or ScoreRepository()
        self.storage = delivery.storage
        self.access_policy = access_policy or ScoreAccessPolicy()

    def list_revision_assets(
        self,
        db: Session,
        score_uuid: str,
        user_id: int | None,
        *,
        revision_uuid: str | None = None,
        include_sources: bool = True,
    ) -> ScoreRevisionAssetsRead:
        access = self.access_policy.authorize_revision(
            db,
            score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        sources = (
            self.repository.list_sources(db, revision_id)
            if include_sources and access.capabilities.can_edit
            else []
        )
        render_assets = self.repository.list_render_assets(db, revision_id)
        return ScoreRevisionAssetsRead(
            revision_sources=[(self._source_read(source, revision)) for source in sources],
            render_assets=[
                (self._render_asset_read(render_asset, revision)) for render_asset in render_assets
            ],
        )

    def source_delivery(
        self,
        db: Session,
        source_uuid: str,
        user_id: int | None,
    ) -> StoredObjectDelivery:
        source, _revision = self._authorized_source(
            db,
            source_uuid,
            user_id,
            ScoreAction.DOWNLOAD,
        )
        return self._delivery(source)

    def render_asset_delivery(
        self,
        db: Session,
        render_asset_uuid: str,
        user_id: int | None,
        *,
        download: bool = True,
    ) -> StoredObjectDelivery:
        render_asset, _revision = self._authorized_render_asset(
            db,
            render_asset_uuid,
            user_id,
            ScoreAction.DOWNLOAD if download else ScoreAction.VIEW,
        )
        return self._delivery(render_asset)

    def source_access_url(
        self,
        db: Session,
        source_uuid: str,
        user_id: int | None,
    ) -> AssetAccessRead:
        source, _revision = self._authorized_source(
            db,
            source_uuid,
            user_id,
            ScoreAction.DOWNLOAD,
        )
        return self._access_read(source, source.source_uuid, "revision-sources")

    def render_asset_access_url(
        self,
        db: Session,
        render_asset_uuid: str,
        user_id: int | None,
    ) -> AssetAccessRead:
        render_asset, _revision = self._authorized_render_asset(
            db,
            render_asset_uuid,
            user_id,
            ScoreAction.DOWNLOAD,
        )
        return self._access_read(render_asset, render_asset.asset_uuid, "render-assets")

    def render_asset_archive(
        self,
        db: Session,
        score_uuid: str,
        user_id: int | None,
        *,
        revision_uuid: str | None = None,
        kind: RenderAssetKind,
        render_profile: str,
    ) -> tuple[io.BytesIO, str]:
        access = self.access_policy.authorize_revision(
            db,
            score_uuid,
            ScoreAction.DOWNLOAD,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        render_assets = self.repository.list_render_assets(
            db,
            require_persisted_id(access.revision.id, entity="score revision"),
            kind,
            render_profile=render_profile,
        )
        if not render_assets:
            raise ResourceNotFoundException(
                "render_asset", score_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for render_asset in render_assets:
                bundle.writestr(
                    render_asset.filename,
                    read_admitted_bytes(
                        self.storage, StoredObjectReadTarget.from_object(render_asset.stored_object)
                    ),
                )
        archive.seek(0)
        return archive, f"score-{score_uuid}-{kind.value.lower()}.zip"

    def _authorized_source(
        self,
        db: Session,
        source_uuid: str,
        user_id: int | None,
        action: ScoreAction,
    ) -> tuple[ScoreRevisionSource, ScoreRevision]:
        source = self.repository.get_source(db, source_uuid)
        if not source:
            raise ResourceNotFoundException(
                "revision_source", source_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        revision = self._authorize_asset_revision(db, source, source_uuid, user_id, action)
        return source, revision

    def _authorized_render_asset(
        self,
        db: Session,
        render_asset_uuid: str,
        user_id: int | None,
        action: ScoreAction,
    ) -> tuple[ScoreRenderAsset, ScoreRevision]:
        render_asset = self.repository.get_render_asset(db, render_asset_uuid)
        if render_asset is None:
            raise ResourceNotFoundException(
                "render_asset", render_asset_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        revision = self._authorize_asset_revision(
            db, render_asset, render_asset_uuid, user_id, action
        )
        return render_asset, revision

    def _authorize_asset_revision(
        self,
        db: Session,
        asset: ScoreAssetRecord,
        asset_uuid: str,
        user_id: int | None,
        action: ScoreAction,
    ) -> ScoreRevision:
        identity = self.repository.revision_identity_for_asset(db, asset)
        if identity is None:
            raise ResourceNotFoundException(
                "revision", asset_uuid, CustomerErrorCode.REVISION_NOT_FOUND
            )
        score_uuid, revision_uuid = identity
        access = self.access_policy.authorize_revision(
            db,
            score_uuid,
            action,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        return access.revision

    def _delivery(self, asset: ScoreAssetRecord) -> StoredObjectDelivery:
        return StoredObjectDelivery.for_object(asset.stored_object, asset.filename)

    def _access_read(
        self, asset: ScoreAssetRecord, asset_uuid: str, route_prefix: str
    ) -> AssetAccessRead:
        return AssetAccessRead(
            asset_id=asset_uuid,
            url=f"{CUSTOMER_API_PREFIX}/{route_prefix}/{asset_uuid}/download",
            filename=asset.filename,
            mime_type=asset.stored_object.content_type,
            expires_in=None,
        )

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
            mime_type=source.stored_object.content_type,
            size_bytes=source.stored_object.byte_size,
            created_at=source.created_at,
        )

    def _render_asset_read(
        self, render_asset: ScoreRenderAsset, revision: ScoreRevision
    ) -> RenderAssetRead:
        return RenderAssetRead(
            render_profile=render_asset.render_profile,
            render_asset_id=render_asset.asset_uuid,
            revision_id=revision.revision_uuid,
            kind=render_asset.kind,
            filename=render_asset.filename,
            mime_type=render_asset.stored_object.content_type,
            size_bytes=render_asset.stored_object.byte_size,
            page_number=render_asset.page_number,
            created_at=render_asset.created_at,
        )
