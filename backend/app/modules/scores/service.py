from __future__ import annotations
from app.storage import ObjectStorage

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.exceptions import (
    ConflictException,
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Score,
    ScoreInputAsset,
    ScoreRevision,
    ScoreRevisionMetadata,
    StoredObject,
    Upload,
)
from app.modules.score_assets.derived_assets import score_derived_assets
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.schemas import ScoreDerivedAssetRead, ScoreDerivedAssetsRead
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.modules.scores.schemas import (
    ScoreInputAssetRead,
    ScoreRead,
    ScoreUpdateRequest,
)
from app.modules.metadata.service import MetadataProjectionService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_assets.render_service import RevisionRenderService
from app.shared.constants import ErrorCode
from app.storage import object_storage
from app.shared.time import utc_now


@dataclass(frozen=True)
class ScoreInputAssetDelivery:
    filename: str
    media_type: str
    storage_key: str


class ScoreService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        storage: ObjectStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        render_service: RevisionRenderService | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        lifecycle_service: ScoreLifecycleService | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or object_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.render_service = render_service or RevisionRenderService(
            access_policy=self.access_policy,
            storage=self.storage,
        )
        self.lifecycle_service = lifecycle_service or ScoreLifecycleService(
            repository=self.repository,
            access_policy=self.access_policy,
        )

    def get(self, db: Session, score_uuid: str, user_id: int) -> ScoreRead:
        access = self.access_policy.authorize(db, score_uuid, ScoreAction.VIEW, user_id=user_id)
        return self._read(db, access.score, access.capabilities)

    def batch_delete(self, db: Session, score_uuids: list[str], user_id: int) -> int:
        removed = 0
        for score_uuid in score_uuids:
            try:
                self.delete(db, score_uuid, user_id)
            except (ResourceNotFoundException, UnauthorizedException):
                continue
            removed += 1
        return removed

    def update(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        request: ScoreUpdateRequest,
    ) -> ScoreRead:
        access = self.access_policy.authorize(db, score_uuid, ScoreAction.EDIT, user_id=user_id)
        score = self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        if score.version != request.expected_version:
            raise ConflictException(
                ErrorCode.REVISION_CONFLICT,
                {"expected_version": request.expected_version, "actual_version": score.version},
            )
        if request.display_title is not None:
            score.display_title = request.display_title.strip()
        if request.genres is not None:
            score.genres = [genre.value for genre in request.genres]
        score.version += 1
        score.updated_at = utc_now()
        db.commit()
        db.refresh(score)
        return self._read(db, score, access.capabilities)

    def delete(self, db: Session, score_uuid: str, user_id: int) -> None:
        self.lifecycle_service.delete_score(db, score_uuid, user_id)

    def input_asset_delivery(
        self,
        db: Session,
        score_uuid: str,
        asset_uuid: str,
        user_id: int,
    ) -> ScoreInputAssetDelivery:
        access = self.access_policy.authorize(db, score_uuid, ScoreAction.EDIT, user_id=user_id)
        score_id = require_persisted_id(access.score.id, entity="score")
        row = (
            db.execute(
                select(ScoreInputAsset, Upload, StoredObject)
                .join(Upload, ScoreInputAsset.upload_id == Upload.id)
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .where(
                    ScoreInputAsset.score_id == score_id,
                    ScoreInputAsset.asset_uuid == asset_uuid,
                )
            )
        ).first()
        if row is None:
            raise ResourceNotFoundException(
                "score_input_asset", asset_uuid, ErrorCode.FILE_NOT_FOUND
            )
        _asset, upload, blob = row
        if not (self.storage.exists(blob.object_key)):
            raise FileException(ErrorCode.FILE_NOT_FOUND, blob.object_key)
        filename = upload.original_filename
        return ScoreInputAssetDelivery(
            filename=filename,
            media_type=blob.content_type,
            storage_key=blob.object_key,
        )

    def _read(
        self,
        db: Session,
        score: Score,
        capabilities: ScoreCapabilities,
    ) -> ScoreRead:
        head = db.get(ScoreRevision, score.head_revision_id) if score.head_revision_id else None
        projection = (
            db.get(ScoreRevisionMetadata, score.head_revision_id)
            if score.head_revision_id
            else None
        )
        score_id = require_persisted_id(score.id, entity="score")
        derived_assets = (
            score_derived_assets(db, self.asset_repository, revision=head)
            if head
            else ScoreDerivedAssetsRead(
                preview=ScoreDerivedAssetRead(status="pending", asset_id=None),
                audio=ScoreDerivedAssetRead(status="pending", asset_id=None),
            )
        )
        input_asset_rows = (
            (
                db.execute(
                    select(ScoreInputAsset, Upload, StoredObject)
                    .join(Upload, ScoreInputAsset.upload_id == Upload.id)
                    .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                    .where(ScoreInputAsset.score_id == score_id)
                    .order_by(col(ScoreInputAsset.sort_order).asc(), col(ScoreInputAsset.id).asc())
                )
            ).all()
            if capabilities.can_edit
            else []
        )
        return ScoreRead(
            score_id=score.score_uuid,
            display_title=score.display_title,
            genres=score.genres,
            version=score.version,
            head_revision_id=head.revision_uuid if head else None,
            derived_assets=derived_assets,
            input_assets=[
                ScoreInputAssetRead(
                    asset_id=asset.asset_uuid,
                    filename=upload.original_filename,
                    mime_type=blob.content_type,
                    size=blob.byte_size,
                    page_number=asset.page_number,
                )
                for asset, upload, blob in input_asset_rows
            ],
            metadata=(
                MetadataProjectionService.to_read(head, projection) if head and projection else None
            ),
            capabilities=capabilities,
            created_at=score.created_at,
            updated_at=score.updated_at,
        )
