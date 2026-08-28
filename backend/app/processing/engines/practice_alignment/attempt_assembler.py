"""Attempt outcome assembly shared by Wait For Note input engines."""

from __future__ import annotations

from dataclasses import dataclass

from app.processing.engines.practice_alignment.attempt_lifecycle import (
    PracticeAttemptLifecycle,
    PracticeAttemptSnapshot,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import PracticeEventEvaluation
from app.processing.engines.practice_alignment.follow_policy import (
    AlignmentAction,
    AlignmentDecision,
    AlignmentReason,
    PracticeDisplayAnchor,
    PracticeExperienceState,
)
from app.processing.engines.practice_alignment.score_timeline import ExpectedPracticeGroup


@dataclass(frozen=True)
class PracticeAttemptOutcome:
    snapshot: PracticeAttemptSnapshot
    evaluation: PracticeEventEvaluation
    policy_profile_version: str


@dataclass(frozen=True)
class ResolvedPracticeAttempt:
    outcome: PracticeAttemptOutcome
    action: AlignmentAction
    resolution_reason: AlignmentReason
    experience_state: PracticeExperienceState
    display_anchor: PracticeDisplayAnchor
    measure_numbers: tuple[str, ...]
    beat_position: float
    confidence: float
    timestamp_ms: int
    validation_confidence: float | None = None
    input_policy_confidence: float | None = None


class PracticeAttemptAssembler:
    """Builds semantically meaningful attempt outcomes from lifecycle and evaluation."""

    def __init__(
        self,
        *,
        lifecycle: PracticeAttemptLifecycle | None = None,
        policy_profile_version: str = "wait-for-note-v1",
    ) -> None:
        self.lifecycle = lifecycle or PracticeAttemptLifecycle()
        self.policy_profile_version = policy_profile_version

    @property
    def current_attempt(self) -> PracticeAttemptSnapshot | None:
        return self.lifecycle.current

    def begin(self, *, expected_group_id: str, timestamp_ms: int) -> PracticeAttemptSnapshot:
        return self.lifecycle.begin(
            expected_group_id=expected_group_id,
            timestamp_ms=timestamp_ms,
        )

    def pending(self, evaluation: PracticeEventEvaluation) -> PracticeAttemptOutcome | None:
        if self.lifecycle.current is None:
            return None
        return PracticeAttemptOutcome(
            snapshot=self.lifecycle.current,
            evaluation=evaluation,
            policy_profile_version=self.policy_profile_version,
        )

    def resolve(
        self,
        evaluation: PracticeEventEvaluation,
        *,
        timestamp_ms: int,
    ) -> PracticeAttemptOutcome | None:
        snapshot = self.lifecycle.resolve(timestamp_ms=timestamp_ms)
        if snapshot is None:
            return None
        return PracticeAttemptOutcome(
            snapshot=snapshot,
            evaluation=evaluation,
            policy_profile_version=self.policy_profile_version,
        )

    def clear_current(self) -> None:
        self.lifecycle.clear_current()

    def reset(self) -> None:
        self.lifecycle.reset()


class ResolvedPracticeAttemptBuffer:
    """Collects resolved attempts before the runtime persists them."""

    def __init__(self) -> None:
        self._attempts: list[ResolvedPracticeAttempt] = []

    def append_for_expected_group(
        self,
        *,
        outcome: PracticeAttemptOutcome | None,
        action: AlignmentAction,
        resolution_reason: AlignmentReason,
        experience_state: PracticeExperienceState,
        expected_group: ExpectedPracticeGroup,
        update_confidence: float,
        update_timestamp_ms: int,
        validation_confidence: float | None = None,
        input_policy_confidence: float | None = None,
    ) -> None:
        resolved_attempt = resolved_attempt_from_outcome(
            outcome=outcome,
            action=action,
            resolution_reason=resolution_reason,
            experience_state=experience_state,
            display_anchor=display_anchor_for_expected_group(expected_group),
            measure_numbers=expected_group.measure_numbers,
            confidence=update_confidence,
            timestamp_ms=update_timestamp_ms,
            validation_confidence=validation_confidence,
            input_policy_confidence=input_policy_confidence,
        )
        if resolved_attempt is not None:
            self._attempts.append(resolved_attempt)

    def drain(self) -> list[ResolvedPracticeAttempt]:
        attempts = self._attempts
        self._attempts = []
        return attempts


def attach_attempt_outcome(
    decision: AlignmentDecision,
    outcome: PracticeAttemptOutcome | None,
) -> None:
    if outcome is None:
        return
    snapshot = outcome.snapshot
    decision["attempt_state"] = snapshot.state
    decision["attempt_id"] = snapshot.attempt_id
    decision["attempt_sequence"] = snapshot.attempt_sequence
    decision["attempt_started_at_ms"] = snapshot.started_at_ms
    if snapshot.resolved_at_ms is not None:
        decision["attempt_resolved_at_ms"] = snapshot.resolved_at_ms
    else:
        decision.pop("attempt_resolved_at_ms", None)
    decision["evaluator_version"] = outcome.evaluation.evaluator_version
    decision["policy_profile_version"] = outcome.policy_profile_version


def resolved_attempt_from_outcome(
    *,
    outcome: PracticeAttemptOutcome | None,
    action: AlignmentAction,
    resolution_reason: AlignmentReason,
    experience_state: PracticeExperienceState,
    display_anchor: PracticeDisplayAnchor,
    measure_numbers: tuple[str, ...],
    confidence: float,
    timestamp_ms: int,
    validation_confidence: float | None = None,
    input_policy_confidence: float | None = None,
) -> ResolvedPracticeAttempt | None:
    if outcome is None or outcome.snapshot.state != "resolved":
        return None
    if "group_id" not in display_anchor:
        return None
    return ResolvedPracticeAttempt(
        outcome=outcome,
        action=action,
        resolution_reason=resolution_reason,
        experience_state=experience_state,
        display_anchor=display_anchor,
        measure_numbers=measure_numbers,
        beat_position=float(display_anchor["beat"]),
        confidence=confidence,
        timestamp_ms=timestamp_ms,
        validation_confidence=validation_confidence,
        input_policy_confidence=input_policy_confidence,
    )


def display_anchor_for_expected_group(group: ExpectedPracticeGroup) -> PracticeDisplayAnchor:
    return {
        "beat": round(group.onset_beat, 3),
        "event_id": group.event_ids[0] if group.event_ids else group.group_id,
        "group_id": group.group_id,
        "render_note_ids": list(group.render_note_ids),
    }
