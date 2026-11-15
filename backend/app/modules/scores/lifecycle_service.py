"""Atomic product deletion admission and best-effort durable dispatch."""

from app.core.async_trace_context import get_async_trace_context
from app.core.request_correlation import get_request_id
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreDeletionOperation
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.scores.repository import ScoreRepository
from app.shared.time import utc_now
from sqlalchemy.orm import Session


class ScoreLifecycleService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()

    def delete_score(self, db: Session, score_uuid: str, user_id: int) -> None:
        access = self.access_policy.authorize(db, score_uuid, ScoreAction.DELETE, user_id=user_id)
        try:
            score = self.repository.get(
                db, access.score.score_uuid, lock=True, include_deleted=True
            )
            if score is None or score.deleted_at is not None:
                return
            now = utc_now()
            score.deleted_at = now
            traceparent, tracestate = get_async_trace_context()
            operation = ScoreDeletionOperation(
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
            db.add(operation)
            db.flush()
            operation_uuid = operation.operation_uuid
            db.commit()
        except Exception:
            db.rollback()
            raise
        from app.worker.dispatch.score_deletion import dispatch_score_deletion_best_effort

        dispatch_score_deletion_best_effort(operation_uuid)


score_lifecycle_service = ScoreLifecycleService()
