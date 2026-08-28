from __future__ import annotations

import json
from collections.abc import Sequence
from typing import TypedDict

from app.db.models import PracticeAttempt, PracticeAttemptResult, PracticeInputSource, PracticeProgressionMode, PracticeSession
from app.processing.reports.practice_scoring_policy import (
    PRACTICE_SESSION_SUMMARY_SCORING_POLICY_VERSION,
    attempt_scoring_included,
    completed_target_count,
    is_scorable_attempt,
)


class PracticeSessionSummaryAttemptPayload(TypedDict):
    attempt_index: int
    attempt_uid: str | None
    started_at_ms: int | None
    resolved_at_ms: int | None
    expected_group_id: str | None
    event_id: str | None
    beat_position: float
    render_note_ids: list[str]
    measure_numbers: list[str]
    result: str
    action: str
    completion_status: str
    scoring_included: bool
    resolution_reason: str
    input_source: str
    evidence_profile: str
    correctness_scope: str
    evaluator_version: str | None
    policy_profile_version: str | None
    confidence: float


class PracticeSessionSummaryTargetPayload(TypedDict):
    expected_group_id: str
    measure_numbers: list[str]
    render_note_ids: list[str]
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    matched_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    completed: bool
    completion_status: str
    last_result: str
    last_confidence: float


class PracticeSessionSummaryMeasurePayload(TypedDict):
    measure_number: str
    target_count: int
    completed_target_count: int
    incomplete_target_count: int
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    average_confidence: float | None
    difficulty_score: float


class PracticeSessionSummaryPayload(TypedDict):
    summary: str
    metrics: dict[str, int | float | str | None]
    recommendations: list[str]
    attempts: list[PracticeSessionSummaryAttemptPayload]
    targets: list[PracticeSessionSummaryTargetPayload]
    difficult_measures: list[PracticeSessionSummaryMeasurePayload]


class PracticeSessionSummaryBuilder:
    """Build a practice session summary from persisted session evidence."""

    def build(
        self,
        session: PracticeSession,
        attempts: Sequence[PracticeAttempt] = (),
    ) -> PracticeSessionSummaryPayload:
        confidence_label = self._confidence_label(session.last_confidence)
        duration_seconds = self._duration_seconds(session)
        evidence_profile = self._evidence_profile(session)
        attempt_metrics = self._attempt_metrics(attempts)
        target_payloads = _target_payloads(attempts)
        difficult_measures = _difficult_measure_payloads(target_payloads)

        return {
            "summary": (
                "Practice session completed with "
                f"{confidence_label.lower()} alignment confidence. "
                f"Evidence profile: {evidence_profile}."
            ),
            "metrics": {
                "state": session.state.value,
                "access_origin": session.access_origin.value,
                "progression_mode": session.progression_mode.value,
                "realtime_guidance": session.realtime_guidance.value,
                "evaluation_profile": session.evaluation_profile.value,
                "input_source": session.input_source.value,
                "evidence_profile": evidence_profile,
                "correctness_scope": self._correctness_scope(session),
                "duration_seconds": duration_seconds,
                "last_beat_position": session.last_beat_position,
                "last_confidence": session.last_confidence,
                "confidence_label": confidence_label,
                **attempt_metrics,
            },
            "recommendations": self._build_recommendations(session, confidence_label, attempts),
            "attempts": [self._attempt_payload(attempt) for attempt in attempts],
            "targets": target_payloads,
            "difficult_measures": difficult_measures,
        }

    @staticmethod
    def _duration_seconds(session: PracticeSession) -> float | None:
        if session.started_at is None or session.finished_at is None:
            return None
        duration = (session.finished_at - session.started_at).total_seconds()
        return round(max(duration, 0.0), 2)

    @staticmethod
    def _confidence_label(confidence: float | None) -> str:
        if confidence is None:
            return "Unknown"
        if confidence >= 0.85:
            return "Strong"
        if confidence >= 0.6:
            return "Stable"
        return "Needs Review"

    @staticmethod
    def _evidence_profile(session: PracticeSession) -> str:
        if session.input_source == PracticeInputSource.MIDI:
            return "MIDI_STRICT"
        if session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE:
            return "MICROPHONE_BEST_EFFORT"
        return "MICROPHONE_ALIGNMENT"

    @staticmethod
    def _correctness_scope(session: PracticeSession) -> str:
        if session.input_source == PracticeInputSource.MIDI:
            return "symbolic_exact_notes"
        if session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE:
            return "acoustic_single_note_strict_chord_best_effort"
        return "continuous_alignment_diagnostics"

    @staticmethod
    def _attempt_metrics(attempts: Sequence[PracticeAttempt]) -> dict[str, int | float | str | None]:
        attempt_count = len(attempts)
        interrupted_attempts = [attempt for attempt in attempts if not is_scorable_attempt(attempt)]
        scorable_attempts = [attempt for attempt in attempts if is_scorable_attempt(attempt)]
        match_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.MATCH)
        partial_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.PARTIAL)
        mismatch_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.MISMATCH)
        uncertain_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.UNCERTAIN)
        attempts_by_target = _attempts_by_target(attempts)
        scorable_attempts_by_target = _attempts_by_target(scorable_attempts)
        target_count = len(attempts_by_target)
        completed_targets = completed_target_count(attempts_by_target)
        scorable_completed_targets = completed_target_count(scorable_attempts_by_target)
        partial_targets = sum(
            1
            for target_attempts in scorable_attempts_by_target.values()
            if any(attempt.result == PracticeAttemptResult.PARTIAL for attempt in target_attempts)
        )
        mismatch_targets = sum(
            1
            for target_attempts in scorable_attempts_by_target.values()
            if any(attempt.result == PracticeAttemptResult.MISMATCH for attempt in target_attempts)
        )
        scorable_attempt_count = len(scorable_attempts)
        scorable_target_count = len(scorable_attempts_by_target)
        interrupted_target_count = sum(
            1
            for target_attempts in attempts_by_target.values()
            if any(not is_scorable_attempt(attempt) for attempt in target_attempts)
        )
        return {
            "scoring_policy_version": PRACTICE_SESSION_SUMMARY_SCORING_POLICY_VERSION,
            "attempt_count": attempt_count,
            "scorable_attempt_count": scorable_attempt_count,
            "interrupted_attempts": len(interrupted_attempts),
            "matched_attempts": match_count,
            "partial_attempts": partial_count,
            "mismatch_attempts": mismatch_count,
            "uncertain_attempts": uncertain_count,
            "match_rate": round(match_count / scorable_attempt_count, 3) if scorable_attempt_count else None,
            "scoring_coverage": (
                round(scorable_attempt_count / attempt_count, 3)
                if attempt_count
                else None
            ),
            "target_count": target_count,
            "scorable_target_count": scorable_target_count,
            "completed_targets": completed_targets,
            "scorable_completed_targets": scorable_completed_targets,
            "interrupted_target_count": interrupted_target_count,
            "targets_with_partial": partial_targets,
            "targets_with_mismatch": mismatch_targets,
            "target_completion_rate": (
                round(completed_targets / target_count, 3)
                if target_count
                else None
            ),
            "scorable_target_completion_rate": (
                round(scorable_completed_targets / scorable_target_count, 3)
                if scorable_target_count
                else None
            ),
        }

    @staticmethod
    def _attempt_payload(attempt: PracticeAttempt) -> PracticeSessionSummaryAttemptPayload:
        return {
            "attempt_index": attempt.attempt_index,
            "attempt_uid": attempt.attempt_uid,
            "started_at_ms": attempt.started_at_ms,
            "resolved_at_ms": attempt.resolved_at_ms,
            "expected_group_id": attempt.expected_group_id,
            "event_id": attempt.event_id,
            "beat_position": round(attempt.beat_position, 3),
            "render_note_ids": _json_string_list(attempt.render_note_ids),
            "measure_numbers": _json_string_list(attempt.measure_numbers),
            "result": attempt.result.value,
            "action": attempt.action,
            "completion_status": attempt.completion_status.value,
            "scoring_included": attempt_scoring_included(attempt),
            "resolution_reason": attempt.resolution_reason.value,
            "input_source": attempt.input_source.value,
            "evidence_profile": attempt.evidence_profile,
            "correctness_scope": attempt.correctness_scope,
            "evaluator_version": attempt.evaluator_version,
            "policy_profile_version": attempt.policy_profile_version,
            "confidence": round(attempt.confidence, 3),
        }

    def _build_recommendations(
        self,
        session: PracticeSession,
        confidence_label: str,
        attempts: Sequence[PracticeAttempt],
    ) -> list[str]:
        recommendations: list[str] = []
        if session.last_confidence is None:
            recommendations.append(
                "Record another full run so the practice engine can build a clearer alignment trail."
            )
        elif session.last_confidence < 0.6:
            recommendations.append(
                "Slow the tempo slightly and keep the pulse steadier to improve alignment stability."
            )
        else:
            recommendations.append(
                "Keep the same pacing and focus on phrasing while timing remains stable."
            )

        if session.last_beat_position is not None and session.last_beat_position <= 4:
            recommendations.append(
                "Try to play further into the score so the summary can cover more of the piece."
            )

        if confidence_label == "Strong":
            recommendations.append(
                "Use the next pass to target articulation and dynamics instead of raw note accuracy."
            )

        if session.input_source == PracticeInputSource.MIDI:
            recommendations.append(
                "MIDI input gives the strictest note evidence; review missed notes as note-entry issues rather than microphone recognition issues."
            )
        elif session.progression_mode == PracticeProgressionMode.WAIT_FOR_NOTE:
            recommendations.append(
                "Microphone step-by-step chord results are best-effort; use MIDI input when exact chord verification matters."
            )

        scorable_attempts = [attempt for attempt in attempts if is_scorable_attempt(attempt)]
        interrupted_count = len(attempts) - len(scorable_attempts)
        if interrupted_count:
            recommendations.append(
                "Some attempts ended because practice was paused, finished, or disconnected; they are shown for context but excluded from learning accuracy."
            )

        if any(attempt.result == PracticeAttemptResult.PARTIAL for attempt in scorable_attempts):
            recommendations.append(
                "Several attempts only matched part of the expected note group; isolate those chords slowly before playing through."
            )
        if any(attempt.result == PracticeAttemptResult.MISMATCH for attempt in scorable_attempts):
            recommendations.append(
                "Review the targets marked as mismatched before increasing tempo."
            )

        return recommendations


practice_session_summary_builder = PracticeSessionSummaryBuilder()


def _attempts_by_target(attempts: Sequence[PracticeAttempt]) -> dict[str, list[PracticeAttempt]]:
    grouped: dict[str, list[PracticeAttempt]] = {}
    for attempt in attempts:
        target_id = attempt.expected_group_id or f"attempt:{attempt.attempt_index}"
        grouped.setdefault(target_id, []).append(attempt)
    return grouped


def _json_string_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]


def _target_payloads(attempts: Sequence[PracticeAttempt]) -> list[PracticeSessionSummaryTargetPayload]:
    targets: list[PracticeSessionSummaryTargetPayload] = []
    for target_id, target_attempts in sorted(
        _attempts_by_target(attempts).items(),
        key=lambda item: item[1][0].attempt_index,
    ):
        scorable_attempts = [attempt for attempt in target_attempts if is_scorable_attempt(attempt)]
        last_attempt = target_attempts[-1]
        completed = any(
            attempt.result == PracticeAttemptResult.MATCH
            for attempt in scorable_attempts
        )
        interrupted_attempt_count = len(target_attempts) - len(scorable_attempts)
        targets.append(
            {
                "expected_group_id": target_id,
                "measure_numbers": _unique_attempt_strings(target_attempts, "measure_numbers"),
                "render_note_ids": _unique_attempt_strings(target_attempts, "render_note_ids"),
                "attempt_count": len(target_attempts),
                "scorable_attempt_count": len(scorable_attempts),
                "interrupted_attempt_count": interrupted_attempt_count,
                "matched_attempt_count": sum(
                    1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.MATCH
                ),
                "partial_attempt_count": sum(
                    1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.PARTIAL
                ),
                "mismatch_attempt_count": sum(
                    1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.MISMATCH
                ),
                "completed": completed,
                "completion_status": "completed" if completed else "incomplete",
                "last_result": last_attempt.result.value,
                "last_confidence": round(last_attempt.confidence, 3),
            }
        )
    return targets


def _difficult_measure_payloads(
    targets: Sequence[PracticeSessionSummaryTargetPayload],
) -> list[PracticeSessionSummaryMeasurePayload]:
    grouped: dict[str, list[PracticeSessionSummaryTargetPayload]] = {}
    for target in targets:
        measure_numbers = target["measure_numbers"] or ["unknown"]
        for measure_number in measure_numbers:
            grouped.setdefault(measure_number, []).append(target)

    measures = [
        _measure_payload(measure_number, measure_targets)
        for measure_number, measure_targets in grouped.items()
    ]
    return sorted(
        measures,
        key=lambda measure: (
            -measure["difficulty_score"],
            _measure_sort_key(measure["measure_number"]),
        ),
    )


def _measure_payload(
    measure_number: str,
    targets: Sequence[PracticeSessionSummaryTargetPayload],
) -> PracticeSessionSummaryMeasurePayload:
    target_count = len(targets)
    completed_target_count = sum(1 for target in targets if target["completed"])
    incomplete_target_count = target_count - completed_target_count
    attempt_count = sum(target["attempt_count"] for target in targets)
    scorable_attempt_count = sum(target["scorable_attempt_count"] for target in targets)
    interrupted_attempt_count = sum(target["interrupted_attempt_count"] for target in targets)
    partial_attempt_count = sum(target["partial_attempt_count"] for target in targets)
    mismatch_attempt_count = sum(target["mismatch_attempt_count"] for target in targets)
    scorable_targets = [
        target for target in targets if target["scorable_attempt_count"] > 0
    ]
    scorable_target_count = len(scorable_targets)
    scorable_incomplete_target_count = sum(
        1 for target in scorable_targets if not target["completed"]
    )
    mismatch_target_count = sum(
        1 for target in scorable_targets if target["mismatch_attempt_count"] > 0
    )
    partial_target_count = sum(
        1 for target in scorable_targets if target["partial_attempt_count"] > 0
    )
    confidences = [
        target["last_confidence"]
        for target in scorable_targets
    ]
    average_confidence = (
        round(sum(confidences) / len(confidences), 3)
        if confidences
        else None
    )
    difficulty_score = _normalized_musical_difficulty_score(
        scorable_target_count=scorable_target_count,
        scorable_incomplete_target_count=scorable_incomplete_target_count,
        mismatch_target_count=mismatch_target_count,
        partial_target_count=partial_target_count,
        scorable_attempt_count=scorable_attempt_count,
    )
    return {
        "measure_number": measure_number,
        "target_count": target_count,
        "completed_target_count": completed_target_count,
        "incomplete_target_count": incomplete_target_count,
        "attempt_count": attempt_count,
        "scorable_attempt_count": scorable_attempt_count,
        "interrupted_attempt_count": interrupted_attempt_count,
        "partial_attempt_count": partial_attempt_count,
        "mismatch_attempt_count": mismatch_attempt_count,
        "average_confidence": average_confidence,
        "difficulty_score": difficulty_score,
    }


def _normalized_musical_difficulty_score(
    *,
    scorable_target_count: int,
    scorable_incomplete_target_count: int,
    mismatch_target_count: int,
    partial_target_count: int,
    scorable_attempt_count: int,
) -> float:
    if scorable_target_count == 0:
        return 0.0
    incomplete_rate = scorable_incomplete_target_count / scorable_target_count
    mismatch_rate = mismatch_target_count / scorable_target_count
    partial_rate = partial_target_count / scorable_target_count
    retry_density = max(0, scorable_attempt_count - scorable_target_count) / scorable_target_count
    return round(
        incomplete_rate * 3
        + mismatch_rate * 2
        + partial_rate
        + retry_density * 0.5,
        3,
    )


def _unique_attempt_strings(
    attempts: Sequence[PracticeAttempt],
    field_name: str,
) -> list[str]:
    values: list[str] = []
    for attempt in attempts:
        raw_value = getattr(attempt, field_name)
        values.extend(_json_string_list(raw_value))
    return list(dict.fromkeys(values))


def _measure_sort_key(measure_number: str) -> tuple[int, int | str]:
    try:
        return (0, int(measure_number))
    except ValueError:
        return (1, measure_number)
