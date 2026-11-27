"""One bounded erasure unit per caller transaction; business services retain lifecycle authority."""

from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.shared.integrity import ResourceIntegrityError
from app.core.config import settings
from app.db.models import (
    AccountDeletionPhase as Phase,
    User,
)
from app.composition.media_resources import (
    build_avatar_service,
    build_upload_service,
    build_take_service,
    build_import_deletion_service,
    build_score_lifecycle_service,
)
from app.modules.account.deletion_delivery import (
    AccountDeletionLease,
    account_deletion_delivery as delivery,
)
from app.modules.account.deletion_repository import AccountDeletionRepository
from app.modules.account.email_identity import try_lock_email_identity

from app.modules.performance_takes.account_cleanup import (
    cleanup_account_take,
    account_take_cleanup_pending,
    erase_account_take_history,
)
from app.modules.uploads.account_cleanup import (
    cleanup_account_upload,
    has_account_uploads,
    erase_account_upload_history,
)
from app.modules.scores.lifecycle_service import has_account_scores
from app.modules.import_jobs.deletion_service import has_account_imports
from app.modules.performance_takes.account_cleanup import has_account_takes
from app.composition.storage_resources import storage_quota_service
from app.composition.storage_resources import storage_usage_service
from app.modules.storage_governance.inventory.contracts import StorageInventoryReader
from app.shared.time import utc_now
from app.modules.media_storage.upload_sessions.account_cleanup import (
    close_account_transfers,
    erase_account_transfers,
)


class AccountDeletionExecutor:
    def __init__(self, inventory: StorageInventoryReader) -> None:
        self.inventory = inventory
        self.avatar = build_avatar_service()
        self.uploads = build_upload_service()
        self.takes = build_take_service()
        self.imports = build_import_deletion_service()
        self.scores = build_score_lifecycle_service()

    def execute(self, db: Session, lease: AccountDeletionLease) -> bool:
        operation = delivery.require(db, lease)
        user_id = operation.user_id_snapshot
        if db.scalar(select(User.deleted_at).where(User.id == user_id)) is None:
            raise ResourceIntegrityError(
                "Account cleanup requires its tombstoned User lifecycle authority"
            )
        if operation.phase == Phase.SCORES:
            result = self.scores.cleanup_for_account(db, user_id)
            if result == "empty":
                operation.phase = Phase.IMPORTS
        elif operation.phase == Phase.IMPORTS:
            result = "progress" if self.imports.cleanup_for_account(db, user_id) else "empty"
            if result == "empty":
                operation.phase = Phase.TAKES
        elif operation.phase == Phase.TAKES:
            result = cleanup_account_take(
                db, user_id, quota=storage_quota_service, takes=self.takes
            )
            if result == "empty":
                operation.phase = Phase.UPLOADS
        elif operation.phase == Phase.UPLOADS:
            if not cleanup_account_upload(
                db, user_id, usage=storage_usage_service, uploads=self.uploads
            ):
                operation.phase = Phase.TRANSFERS
            result = "progress"
        elif operation.phase == Phase.TRANSFERS:
            result = close_account_transfers(db, user_id)
            if result == "empty":
                operation.phase = Phase.FINALIZE
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
            raise ResourceIntegrityError("Erasure requires its tombstoned User")
        if not try_lock_email_identity(db, user.email):
            return "busy"
        # No pre-admitted writer can cross the exclusive User lock. A writer
        # admitted before the tombstone may have added a graph after a phase scan.
        if any(
            check(db, user_id)
            for check in (
                has_account_scores,
                has_account_imports,
                has_account_takes,
                has_account_uploads,
            )
        ):
            return "restart"
        if account_take_cleanup_pending(db, user_id):
            return "restart"
        if not storage_quota_service.try_lock_user(db, user_id):
            return "busy"
        storage_quota_service.lock_user(db, user_id)
        if storage_quota_service.release_next_held_for_user(db, user_id):
            return "progress"
        limit = settings.ACCOUNT_DELETION_RESOURCE_BATCH_SIZE
        from app.modules.collaboration.mail_lifecycle import close_account_collaboration_data

        if close_account_collaboration_data(
            db, user_id=user_id, email=user.email, closed_at=user.deleted_at, limit=limit
        ):
            return "progress"
        if erase_account_take_history(db, user_id, limit=limit):
            return "progress"
        if any(self.inventory.snapshot_user(db, user_id).used_bytes.values()):
            raise ResourceIntegrityError("Account erasure found live semantic storage inventory")
        storage_usage_service.assert_empty_account(db, user_id)
        from app.modules.library.service import LibraryService
        from app.modules.collaboration.membership_service import MembershipService
        from app.modules.notifications.service import NotificationService

        from app.modules.auth.account_cleanup import erase_authentication_history
        from app.modules.revisions.account_cleanup import erase_revision_actor_links
        from app.modules.playback.account_cleanup import erase_playback_requester_links
        from app.modules.realtime.account_cleanup import erase_recipient_replay
        from app.modules.practice.activities.account_cleanup import erase_account_activities

        if (
            erase_account_upload_history(db, user_id, limit=limit)
            or erase_account_transfers(db, user_id, limit=limit)
            or LibraryService().erase_user_state(db, user_id, limit=limit)
            or MembershipService().erase_user_memberships(db, user_id, limit=limit)
            or NotificationService().erase_recipient_history(db, user_id, limit=limit)
            or erase_revision_actor_links(db, user_id, limit=limit)
            or erase_playback_requester_links(db, user_id, limit=limit)
            or erase_authentication_history(db, user_id, limit=limit)
            or AccountDeletionRepository().erase_security_history(db, user_id, limit=limit)
            or erase_account_activities(db, user_id, limit=limit)
            or erase_recipient_replay(db, user_id, limit=limit)
            or storage_usage_service.erase_empty_account_history(db, user_id, limit=limit)
            or storage_quota_service.erase_terminal_user_holds(db, user_id, limit=limit)
        ):
            return "progress"
        self.avatar.clear_user_avatar(db, user)
        db.flush()
        AccountDeletionRepository().erase_closed_identity(db, user)
        return "completed"
