"""Score-owned deletion admission and its post-commit latency hint."""

from sqlalchemy import insert
from sqlalchemy.orm import Session
from app.core.async_trace_context import get_async_trace_context
from app.core.request_correlation import get_request_id
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreDeletionOperation
from app.modules.scores.repository import ScoreRepository
from app.modules.score_access.actions import ScoreAction, semantics_for
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


class ScoreLifecycleService:
    def __init__(self, repository: ScoreRepository | None = None) -> None:
        self.repository = repository or ScoreRepository()

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
        from app.worker.dispatch.score_deletion import dispatch_score_deletion_best_effort

        for operation_uuid in operations:
            try:
                dispatch_score_deletion_best_effort(operation_uuid)
            except Exception as exc:
                logger.bind(operation_id=operation_uuid, exception_type=type(exc).__name__).warning(
                    "score_deletion.immediate_dispatch_failed"
                )
        return len(operations)

    def delete_score(self, db: Session, score_uuid: str, user_id: int) -> None:
        self.delete_scores(db, [score_uuid], user_id)


score_lifecycle_service = ScoreLifecycleService()
