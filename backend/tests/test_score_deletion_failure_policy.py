from typing import cast
from unittest.mock import Mock

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Score, ScoreDeletionStatus
from app.modules.scores.deletion_failure_policy import ScoreDeletionFailurePolicy


def test_score_deletion_failure_policy_uses_bounded_exponential_backoff() -> None:
    policy = ScoreDeletionFailurePolicy()

    assert policy.retry_delay_seconds(1) == settings.SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS
    assert policy.retry_delay_seconds(3) == settings.SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS * 4
    assert policy.retry_delay_seconds(99) == settings.SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS * 64


def test_score_deletion_failure_policy_records_retry_diagnostic() -> None:
    score = Score(
        id=17,
        score_uuid="score-1",
        owner_user_id=7,
        title="Score",
        deletion_status=ScoreDeletionStatus.DELETING,
        cleanup_attempt_count=0,
    )
    database = Mock()
    database.get.return_value = score

    ScoreDeletionFailurePolicy().mark_failed(
        cast(Session, database),
        17,
        RuntimeError("object storage temporarily unavailable"),
    )

    assert score.cleanup_attempt_count == 1
    assert score.next_cleanup_at is not None
    assert score.deletion_error == "object storage temporarily unavailable"
    assert score.internal_error_code == "score_deletion_transient_failure"
    assert score.internal_error_stage == "cleanup"
    assert score.internal_error_class == "transient"
    assert score.internal_error_retryable is True
    database.commit.assert_called_once()
