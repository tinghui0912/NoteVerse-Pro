"""Scoring policy for practice session summary metrics."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from app.db.models import (
    PracticeAttempt,
    PracticeAttemptCompletionStatus,
    PracticeAttemptResult,
)


PRACTICE_SESSION_SUMMARY_SCORING_POLICY_VERSION = "practice-session-summary-scoring-v1"


def is_scorable_attempt(attempt: PracticeAttempt) -> bool:
    return attempt.completion_status == PracticeAttemptCompletionStatus.COMPLETED


def attempt_scoring_included(attempt: PracticeAttempt) -> bool:
    return is_scorable_attempt(attempt)


def completed_target_count(attempts_by_target: Mapping[str, Sequence[PracticeAttempt]]) -> int:
    return sum(
        1
        for target_attempts in attempts_by_target.values()
        if any(attempt.result == PracticeAttemptResult.MATCH for attempt in target_attempts)
    )
