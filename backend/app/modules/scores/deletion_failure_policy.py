from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Score, ScoreDeletionStatus
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
)
from app.utils.timezone import utc_now_naive


class ScoreDeletionFailurePolicy:
    """Persist retry state and diagnostics for failed score-deletion cleanup attempts."""

    def mark_failed(self, db: Session, score_id: int, exc: Exception) -> None:
        score = db.get(Score, score_id)
        if score is None or score.deletion_status != ScoreDeletionStatus.DELETING:
            return
        now = utc_now_naive()
        score.cleanup_attempt_count += 1
        retry_delay = self.retry_delay_seconds(score.cleanup_attempt_count)
        score.next_cleanup_at = now + timedelta(seconds=retry_delay)
        score.deletion_error = str(exc)[:4000]
        apply_async_diagnostic(
            score,
            kind=AsyncOperationKindValue.SCORE_DELETION,
            status=(
                AsyncOperationStatusValue.EXHAUSTED
                if score.cleanup_attempt_count >= settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS
                else AsyncOperationStatusValue.RETRYING
            ),
            raw_status=score.deletion_status.value,
            last_error=score.deletion_error,
            attempts=score.cleanup_attempt_count,
            max_attempts=settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
        )
        db.commit()

    @staticmethod
    def retry_delay_seconds(attempt_count: int) -> int:
        exponent = min(max(attempt_count - 1, 0), 6)
        return settings.SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS * (2**exponent)
