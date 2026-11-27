"""Score-owned deletion admission and its post-commit latency hint."""

from app.modules.scores.deletion_delivery import ScoreDeletionDeliveryService
from collections.abc import Callable
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings

from app.modules.scores.deletion_executor import ScoreDeletionExecutor
from sqlalchemy import insert, select
from sqlalchemy.orm import Session
from app.shared.integrity import ResourceIntegrityError
from app.core.async_trace_context import get_async_trace_context
from app.platform.correlation import get_request_id
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreDeletionOperation, Score, User
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.scores.repository import ScoreRepository
from app.modules.collaboration.mail_lifecycle import cancel_invite_mail_for_scores
from app.modules.score_access.actions import ScoreAction, semantics_for
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


class ScoreLifecycleService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        *,
        deletion_executor: ScoreDeletionExecutor,
        config: ScoreDeletionDeliverySettings,
        dispatch_after_commit: Callable[[str], None],
    ) -> None:
        self.dispatch_after_commit = dispatch_after_commit
        self.config = config
        self.delivery = ScoreDeletionDeliveryService(config=config)
        self.repository = repository or ScoreRepository()
        self.deletion_executor = deletion_executor

    def cleanup_for_account(self, db: Session, user_id: int) -> str:
        """Erase one owned graph using its existing deletion authority."""

        score = db.scalar(
            select(Score).where(Score.owner_user_id == user_id).order_by(Score.id).limit(1)
        )
        if score is None:
            return "empty"
        if score.deleted_at is None:
            self.admit_account_score(db, score.score_uuid, user_id)
            # Commit parent admission as its own bounded unit. Graph execution
            # always starts afresh in Operation -> Score order, including when
            # a concurrent customer admission won the Score lock.
            return "admitted"
        operation = db.scalar(
            select(ScoreDeletionOperation).where(
                ScoreDeletionOperation.score_uuid == score.score_uuid
            )
        )
        if operation is None:
            raise ResourceIntegrityError("Tombstoned Score has no deletion operation")
        lease = self.delivery.claim(db, operation.operation_uuid)
        if lease is None:
            if operation.attempt_count >= self.config.SCORE_DELETION_MAX_ATTEMPTS:
                raise ResourceIntegrityError("Owned Score deletion has exhausted retries")
            return "busy"
        db.flush()
        self.deletion_executor.execute(db, lease)
        return "deleted"

    def admit_deletions(self, db: Session, score_uuids: list[str], user_id: int) -> list[str]:
        """Validate and admit the complete unique set; caller owns commit and rollback."""
        requested = sorted(set(score_uuids))
        if not requested:
            return []
        scores = self.repository.lock_active_deletion_set(db, requested)
        found = {score.score_uuid for score in scores}
        for uuid in requested:
            if uuid not in found:
                raise ResourceNotFoundException("score", uuid, CustomerErrorCode.SCORE_NOT_FOUND)
        # DELETE is the owner's lifecycle authority, independent of collaboration role.
        for score in scores:
            if score.owner_user_id != user_id:
                raise UnauthorizedException(
                    semantics_for(ScoreAction.DELETE).denial_code, {"score_id": score.score_uuid}
                )
        lock_active_resource_user(db, user_id)
        return self._admit_rows(db, scores)

    def admit_account_score(self, db: Session, score_uuid: str, user_id: int) -> list[str]:
        """Account erasure is a parent lifecycle authority, not an active-user DELETE action."""
        if db.scalar(select(User.deleted_at).where(User.id == user_id)) is None:
            raise ValueError("Account erasure requires a tombstoned User")
        score = db.scalar(
            select(Score)
            .where(
                Score.score_uuid == score_uuid,
                Score.owner_user_id == user_id,
                Score.__table__.c.deleted_at.is_(None),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return self._admit_rows(db, [score]) if score is not None else []

    def _admit_rows(self, db: Session, scores: list[Score]) -> list[str]:
        now = utc_now()
        traceparent, tracestate = get_async_trace_context()
        operations = []
        for score in scores:
            score.deleted_at = now
            operations.append(
                ScoreDeletionOperation(
                    score_id=require_persisted_id(score.id, entity="score"),
                    score_uuid=score.score_uuid,
                    owner_user_id=score.owner_user_id,
                    originating_request_id=get_request_id(),
                    traceparent=traceparent,
                    tracestate=tracestate,
                    created_at=now,
                    updated_at=now,
                    next_attempt_at=now,
                )
            )
        cancel_invite_mail_for_scores(
            db, [require_persisted_id(score.id, entity="score") for score in scores]
        )
        db.execute(
            insert(ScoreDeletionOperation).values(
                [operation.model_dump(exclude={"id"}) for operation in operations]
            )
        )
        return [operation.operation_uuid for operation in operations]

    def delete_scores(self, db: Session, score_uuids: list[str], user_id: int) -> int:
        try:
            operations = self.admit_deletions(db, score_uuids, user_id)
            db.commit()
        except Exception:
            db.rollback()
            raise

        for operation_uuid in operations:
            try:
                self.dispatch_after_commit(operation_uuid)
            except Exception as exc:
                logger.bind(operation_id=operation_uuid, exception_type=type(exc).__name__).warning(
                    "score_deletion.immediate_dispatch_failed"
                )
        return len(operations)

    def delete_score(self, db: Session, score_uuid: str, user_id: int) -> None:
        self.delete_scores(db, [score_uuid], user_id)


def has_account_scores(db: Session, user_id: int) -> bool:
    """Whether this domain still owns semantic resources for the account."""
    return db.scalar(select(Score.id).where(Score.owner_user_id == user_id).limit(1)) is not None
