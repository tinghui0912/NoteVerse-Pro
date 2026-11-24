"""Score-owned semantic input allocation, conversion and final-reference release."""

from datetime import timedelta
from uuid import uuid4
from sqlalchemy.orm import Session
from app.core.exceptions import UnauthorizedException, ResourceNotFoundException, ConflictException
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from app.db.models import ScoreInputAsset, StorageUsageCategory as Category
from app.modules.storage_usage.service import storage_usage_service as usage
from app.composition.storage_resources import storage_quota_service as quota
from .input_asset_repository import ScoreInputAssetRepository


class ScoreInputAssetLifecycle:
    def __init__(self, repository: ScoreInputAssetRepository | None = None) -> None:
        self.repository = repository or ScoreInputAssetRepository()

    def promote_import_uploads(
        self, db: Session, *, job_id: int, score_id: int, user_id: int
    ) -> None:
        score = self.repository.lock_score(db, score_id)
        if score is None or score.deleted_at is not None:
            raise ResourceNotFoundException("score", str(score_id))
        if score.owner_user_id != user_id or self.repository.job_owner(db, job_id) != user_id:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        from app.modules.account.resource_admission import lock_active_resource_user

        lock_active_resource_user(db, user_id)
        quota.lock_user(db, user_id)
        uploads = self.repository.lock_import_uploads(db, job_id)
        if any(upload.uploader_user_id != user_id for upload in uploads):
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        existing = self.repository.existing_inputs(db, [upload.id for upload in uploads])
        counted = {asset.upload_id for asset in existing}
        current = {asset.upload_id: asset for asset in existing if asset.score_id == score_id}
        for upload in uploads:
            if upload.id in current:
                asset = current[upload.id]
                if (asset.page_number, asset.sort_order) != (upload.page_number, upload.sort_order):
                    raise ConflictException(
                        CustomerErrorCode.VALIDATION_ERROR, {"reason": "score_input_conflict"}
                    )
                continue
            identity = str(uuid4())
            if upload.id not in counted:
                # This is the same User's already-admitted occupancy, not positive growth.
                usage.record_release(
                    db,
                    user_id=user_id,
                    category=Category.UPLOAD,
                    bytes_count=upload.byte_size,
                    reason="upload_promoted_to_score_input",
                    object_type="upload",
                    object_id=upload.upload_uuid,
                    storage_key=upload.object_key,
                )
            else:
                hold = quota.create_hold(
                    db,
                    user_id=user_id,
                    category=Category.INPUT_ASSET,
                    bytes_count=upload.byte_size,
                    command_key="input-asset:" + identity,
                    expires_at=utc_now() + timedelta(minutes=15),
                )
                if not quota.consume_hold(db, hold.hold_id):
                    raise RuntimeError("New Score input requires fresh capacity admission")
            db.add(
                ScoreInputAsset(
                    asset_uuid=identity,
                    score_id=score_id,
                    upload_id=upload.id,
                    page_number=upload.page_number,
                    sort_order=upload.sort_order,
                )
            )
            usage.record_allocation(
                db,
                user_id=user_id,
                category=Category.INPUT_ASSET,
                bytes_count=upload.byte_size,
                reason="score_input_asset_created",
                object_type="score_input_asset",
                object_id=identity,
                storage_key=upload.object_key,
            )
            counted.add(upload.id)
        db.flush()

    def release_score_inputs(self, db: Session, *, score_id: int, user_id: int) -> list[int]:
        """Caller holds Score. Return orphaned objects for its final retirement admission."""
        usage.committed_bytes(db, user_id, lock=True)
        uploads = self.repository.lock_score_uploads(db, score_id)
        if any(upload.uploader_user_id != user_id for upload in uploads):
            raise RuntimeError("Score input ownership differs from its admitted Upload owner")
        by_id = {upload.id: upload for upload in uploads}
        inputs = [
            asset
            for asset in self.repository.existing_inputs(db, list(by_id))
            if asset.score_id == score_id
        ]
        self.repository.delete_score_inputs(db, score_id)
        for asset in inputs:
            upload = by_id[asset.upload_id]
            usage.record_release(
                db,
                user_id=user_id,
                category=Category.INPUT_ASSET,
                bytes_count=upload.byte_size,
                reason="delete_score",
                object_type="score_input_asset",
                object_id=asset.asset_uuid,
                storage_key=upload.object_key,
            )
        remaining, retained = self.repository.reference_sets(db, list(by_id))
        orphans = []
        for upload in uploads:
            if upload.id in remaining:
                continue
            if upload.id in retained:
                # Restoring a surviving Upload reduces/preserves occupancy even over quota.
                usage.record_allocation(
                    db,
                    user_id=user_id,
                    category=Category.UPLOAD,
                    bytes_count=upload.byte_size,
                    reason="score_input_returned_to_upload",
                    object_type="upload",
                    object_id=upload.upload_uuid,
                    storage_key=upload.object_key,
                )
            else:
                orphans.append(upload)
        self.repository.delete_uploads(db, [upload.id for upload in orphans])
        return [upload.object_id for upload in orphans]


score_input_asset_lifecycle = ScoreInputAssetLifecycle()
