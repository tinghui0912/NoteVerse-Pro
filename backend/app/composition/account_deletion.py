"""One bounded erasure unit per caller transaction; business services retain lifecycle authority."""

from datetime import timedelta
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models import (
    AccountDeletionPhase as Phase,
    User,
    Upload,
    UploadCreationRequest,
    StorageQuotaHold,
    StorageQuotaHoldStatus,
    StorageUsageCounter,
)
from app.modules.account.avatar_service import avatar_service
from app.modules.account.deletion_delivery import (
    AccountDeletionLease,
    account_deletion_delivery as delivery,
)
from app.modules.account.deletion_repository import AccountDeletionRepository
from app.modules.import_jobs.deletion_service import ImportJobDeletionService
from app.modules.scores.lifecycle_service import score_lifecycle_service
from app.modules.performance_takes.account_cleanup import (
    cleanup_account_take,
    account_take_cleanup_pending,
    erase_account_take_history,
)
from app.modules.uploads.service import upload_service
from app.composition.storage_resources import storage_quota_service
from app.modules.storage_usage.service import storage_usage_service
from app.modules.storage_inventory.contracts import StorageInventoryReader
from app.shared.time import utc_now


class AccountDeletionExecutor:
    def __init__(self, inventory: StorageInventoryReader) -> None:
        self.inventory = inventory

    def execute(self, db: Session, lease: AccountDeletionLease) -> bool:
        operation = delivery.require(db, lease)
        user_id = operation.user_id_snapshot
        if db.scalar(select(User.deleted_at).where(User.id == user_id)) is None:
            raise RuntimeError("Account cleanup requires its tombstoned User lifecycle authority")
        if operation.phase == Phase.SCORES:
            result = score_lifecycle_service.cleanup_for_account(db, user_id)
            if result == "empty":
                operation.phase = Phase.IMPORTS
        elif operation.phase == Phase.IMPORTS:
            result = (
                "progress"
                if ImportJobDeletionService().cleanup_for_account(db, user_id)
                else "empty"
            )
            if result == "empty":
                operation.phase = Phase.TAKES
        elif operation.phase == Phase.TAKES:
            result = cleanup_account_take(db, user_id)
            if result == "empty":
                operation.phase = Phase.UPLOADS
        elif operation.phase == Phase.UPLOADS:
            storage_usage_service.committed_bytes(db, user_id, lock=True)
            upload = db.scalar(
                select(Upload)
                .where(Upload.uploader_user_id == user_id)
                .order_by(Upload.id)
                .limit(1)
            )
            if upload is None:
                operation.phase = Phase.FINALIZE
            else:
                user = db.get(User, user_id)
                if user is None:
                    raise RuntimeError("Account disappeared before resource cleanup")
                upload_service.delete_upload(db, user, upload.upload_uuid)
            result = "progress"
        else:
            result = self._finalize(db, user_id)
            if result == "restart":
                operation.phase = Phase.SCORES
            if result == "completed":
                delivery.complete(db, lease)
                return True
        delivery.continue_at(
            db,
            lease,
            utc_now()
            + (
                timedelta(seconds=settings.ACCOUNT_DELETION_INTERVAL_SECONDS)
                if result == "busy"
                else timedelta()
            ),
        )
        return False

    def _finalize(self, db: Session, user_id: int) -> str:
        user = AccountDeletionRepository().lock_user(db, user_id, erasure=True)
        if user is None or user.deleted_at is None:
            raise RuntimeError("Erasure requires its tombstoned User")
        # No pre-admitted writer can cross the exclusive User lock. A writer
        # admitted before the tombstone may have added a graph after a phase scan.
        from app.db.models import Score, ImportJob, PerformanceTake

        for model, owner in (
            (Score, Score.owner_user_id),
            (ImportJob, ImportJob.user_id),
            (PerformanceTake, PerformanceTake.owner_user_id),
            (Upload, Upload.uploader_user_id),
        ):
            if db.scalar(select(model.id).where(owner == user_id).limit(1)) is not None:
                return "restart"
        if account_take_cleanup_pending(db, user_id):
            return "restart"
        if not storage_quota_service.try_lock_user(db, user_id):
            return "busy"
        storage_quota_service.lock_user(db, user_id)
        hold = db.scalar(
            select(StorageQuotaHold)
            .where(
                StorageQuotaHold.user_id == user_id,
                StorageQuotaHold.status == StorageQuotaHoldStatus.HELD,
            )
            .order_by(StorageQuotaHold.id)
            .limit(1)
        )
        if hold is not None:
            storage_quota_service.release_hold(db, hold.id)
            return "progress"
        erase_account_take_history(db, user_id)
        if any(self.inventory.snapshot_user(db, user_id).used_bytes.values()):
            raise RuntimeError("Account erasure found live semantic storage inventory")
        if storage_usage_service.committed_bytes(db, user_id, lock=True) or db.scalar(
            select(StorageUsageCounter.user_id)
            .where(StorageUsageCounter.user_id == user_id, StorageUsageCounter.used_bytes != 0)
            .limit(1)
        ):
            raise RuntimeError("Account erasure found unreleased usage accounting")
        from app.modules.library.service import LibraryService
        from app.modules.collaboration.membership_service import MembershipService
        from app.modules.notifications.service import NotificationService

        LibraryService().erase_user_state(db, user_id)
        MembershipService().erase_user_memberships(db, user_id)
        NotificationService().erase_recipient_history(db, user_id)
        db.execute(delete(UploadCreationRequest).where(UploadCreationRequest.user_id == user_id))
        avatar_service.clear_user_avatar(db, user)
        db.flush()
        db.execute(delete(User).where(User.id == user_id))
        return "completed"
