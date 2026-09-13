from __future__ import annotations

import json
from collections.abc import Sequence
from typing import TypedDict

from app.db.models import (
    PracticeAttempt,
    PracticeAttemptCompletionStatus,
    PracticeAttemptResult,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeSession,
)
from app.db.models.practice import PracticeEvaluationProfile
from app.processing.performance.evidence import (
    PerformanceExpectedEventOutcome,
    PerformanceExpectedEventResult,
    PerformanceExpectedStrikeResult,
    PerformanceObservation,
    PerformanceSummaryAccumulator,
)
from app.processing.reports.practice_scoring_policy import (
    PRACTICE_SESSION_SUMMARY_SCORING_POLICY_VERSION,
    completed_target_count,
    is_scorable_attempt,
)


class PracticeSessionSummaryTargetPayload(TypedDict):
    expected_group_id: str
    measure_numbers: list[str]
    render_note_ids: list[str]
    confirmed_correct_render_note_ids: list[str]
    confirmed_error_render_note_ids: list[str]
    missing_pitches: list[str]
    unexpected_pitches: list[str]
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    skipped_attempt_count: int
    matched_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    completed: bool
    completion_status: str
    last_result: str
    last_confidence: float


class PracticeSessionSummaryProblemMeasurePayload(TypedDict):
    measure_number: str
    target_count: int
    completed_target_count: int
    incomplete_target_count: int
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    skipped_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    average_confidence: float | None


class PracticeSessionSummaryPayload(TypedDict):
    metrics: dict[str, int | float | str | None]
    targets: list[PracticeSessionSummaryTargetPayload]
    problem_measures: list[PracticeSessionSummaryProblemMeasurePayload]


class PracticeSessionSummaryBuilder:
    """Build a practice session summary from persisted session evidence."""

    def build(
        self,
        session: PracticeSession,
        attempts: Sequence[PracticeAttempt] = (),
        *,
        performance_observations: Sequence[PerformanceObservation] = (),
        performance_outcomes: Sequence[PerformanceExpectedEventOutcome] = (),
    ) -> PracticeSessionSummaryPayload:
        if session.evaluation_profile == PracticeEvaluationProfile.PERFORMANCE:
            return self._build_performance_summary(
                session,
                observations=performance_observations,
                outcomes=performance_outcomes,
            )

        duration_seconds = self._duration_seconds(session)
        evidence_profile = self._evidence_profile(session)
        attempt_metrics = self._attempt_metrics(attempts)
        target_payloads = _target_payloads(attempts)
        problem_measures = _problem_measure_payloads(target_payloads)

        return {
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
                **attempt_metrics,
            },
            "targets": target_payloads,
            "problem_measures": problem_measures,
        }

    @staticmethod
    def _build_performance_summary(
        session: PracticeSession,
        *,
        observations: Sequence[PerformanceObservation],
        outcomes: Sequence[PerformanceExpectedEventOutcome],
    ) -> PracticeSessionSummaryPayload:
        accumulator = PerformanceSummaryAccumulator.from_session(
            session,
            observations=observations,
            outcomes=outcomes,
        )
        metrics = accumulator.metrics()
        target_payloads = _performance_target_payloads(outcomes)
        problem_targets = _performance_targets_with_confirmed_issues(target_payloads)
        problem_measures = _problem_measure_payloads(problem_targets)
        return {
            "metrics": {
                "state": session.state.value,
                "access_origin": session.access_origin.value,
                "progression_mode": session.progression_mode.value,
                "realtime_guidance": session.realtime_guidance.value,
                "evaluation_profile": session.evaluation_profile.value,
                **metrics,
                "confirmed_correct_strike_targets": _confirmed_correct_strike_count(outcomes),
                "missing_strike_targets": _missing_strike_count(outcomes),
                "extra_pitch_count": _unexpected_pitch_count(outcomes),
                "problem_measure_count": len(problem_measures),
            },
            "targets": target_payloads,
            "problem_measures": problem_measures,
        }

    @staticmethod
    def _duration_seconds(session: PracticeSession) -> float | None:
        if session.started_at is None or session.finished_at is None:
            return None
        duration = (session.finished_at - session.started_at).total_seconds()
        return round(max(duration, 0.0), 2)

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
        interrupted_attempts = [
            attempt
            for attempt in attempts
            if attempt.completion_status != PracticeAttemptCompletionStatus.COMPLETED
        ]
        scorable_attempts = [attempt for attempt in attempts if is_scorable_attempt(attempt)]
        match_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.MATCH)
        partial_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.PARTIAL)
        mismatch_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.MISMATCH)
        uncertain_count = sum(1 for attempt in scorable_attempts if attempt.result == PracticeAttemptResult.UNCERTAIN)
        skipped_attempts = [attempt for attempt in attempts if attempt.result == PracticeAttemptResult.SKIPPED]
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
            if any(
                attempt.completion_status != PracticeAttemptCompletionStatus.COMPLETED
                for attempt in target_attempts
            )
        )
        return {
            "scoring_policy_version": PRACTICE_SESSION_SUMMARY_SCORING_POLICY_VERSION,
            "attempt_count": attempt_count,
            "scorable_attempt_count": scorable_attempt_count,
            "interrupted_attempts": len(interrupted_attempts),
            "skipped_attempts": len(skipped_attempts),
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
        interrupted_attempt_count = sum(
            1
            for attempt in target_attempts
            if attempt.completion_status != PracticeAttemptCompletionStatus.COMPLETED
        )
        skipped_attempt_count = sum(
            1 for attempt in target_attempts if attempt.result == PracticeAttemptResult.SKIPPED
        )
        targets.append(
            {
                "expected_group_id": target_id,
                "measure_numbers": _unique_attempt_strings(target_attempts, "measure_numbers"),
                "render_note_ids": _unique_attempt_strings(target_attempts, "render_note_ids"),
                "confirmed_correct_render_note_ids": [],
                "confirmed_error_render_note_ids": [],
                "missing_pitches": [],
                "unexpected_pitches": [],
                "attempt_count": len(target_attempts),
                "scorable_attempt_count": len(scorable_attempts),
                "interrupted_attempt_count": interrupted_attempt_count,
                "skipped_attempt_count": skipped_attempt_count,
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


def _problem_measure_payloads(
    targets: Sequence[PracticeSessionSummaryTargetPayload],
) -> list[PracticeSessionSummaryProblemMeasurePayload]:
    grouped: dict[str, list[PracticeSessionSummaryTargetPayload]] = {}
    for target in targets:
        measure_numbers = target["measure_numbers"] or ["unknown"]
        for measure_number in measure_numbers:
            grouped.setdefault(measure_number, []).append(target)

    measures = [
        _measure_payload(measure_number, measure_targets)
        for measure_number, measure_targets in grouped.items()
    ]
    return sorted(measures, key=lambda measure: _measure_sort_key(measure["measure_number"]))


def _performance_target_payloads(
    outcomes: Sequence[PerformanceExpectedEventOutcome],
) -> list[PracticeSessionSummaryTargetPayload]:
    targets: list[PracticeSessionSummaryTargetPayload] = []
    for outcome in outcomes:
        matched = outcome.result == PerformanceExpectedEventResult.MATCH
        partial = outcome.result == PerformanceExpectedEventResult.PARTIAL
        mismatch = outcome.result == PerformanceExpectedEventResult.MISMATCH
        scorable = outcome.result != PerformanceExpectedEventResult.NOT_OBSERVED
        confirmed_correct_render_note_ids = [
            render_note_id
            for strike in outcome.expected_strike_outcomes
            if strike.result == PerformanceExpectedStrikeResult.MATCHED
            for render_note_id in strike.render_note_ids
        ]
        confirmed_error_render_note_ids = [
            render_note_id
            for strike in outcome.expected_strike_outcomes
            if strike.result == PerformanceExpectedStrikeResult.MISSING
            for render_note_id in strike.render_note_ids
        ]
        missing_pitches = [
            strike.pitch
            for strike in outcome.expected_strike_outcomes
            if strike.result == PerformanceExpectedStrikeResult.MISSING
        ]
        targets.append(
            {
                "expected_group_id": outcome.expected_group_id,
                "measure_numbers": list(outcome.measure_numbers),
                "render_note_ids": list(outcome.render_note_ids),
                "confirmed_correct_render_note_ids": confirmed_correct_render_note_ids,
                "confirmed_error_render_note_ids": confirmed_error_render_note_ids,
                "missing_pitches": missing_pitches,
                "unexpected_pitches": list(outcome.unexpected_pitches),
                "attempt_count": 1,
                "scorable_attempt_count": 1 if scorable else 0,
                "interrupted_attempt_count": 0,
                "skipped_attempt_count": 0,
                "matched_attempt_count": 1 if matched else 0,
                "partial_attempt_count": 1 if partial else 0,
                "mismatch_attempt_count": 1 if mismatch else 0,
                "completed": matched,
                "completion_status": "completed" if matched else "incomplete",
                "last_result": outcome.result.value,
                "last_confidence": round(outcome.confidence, 3),
            }
        )
    return targets


def _performance_targets_with_confirmed_issues(
    targets: Sequence[PracticeSessionSummaryTargetPayload],
) -> list[PracticeSessionSummaryTargetPayload]:
    return [
        target
        for target in targets
        if target["scorable_attempt_count"] > 0
        and (target["partial_attempt_count"] > 0 or target["mismatch_attempt_count"] > 0)
    ]


def _confirmed_correct_strike_count(outcomes: Sequence[PerformanceExpectedEventOutcome]) -> int:
    return sum(
        1
        for outcome in outcomes
        for strike in outcome.expected_strike_outcomes
        if strike.result == PerformanceExpectedStrikeResult.MATCHED
    )


def _missing_strike_count(outcomes: Sequence[PerformanceExpectedEventOutcome]) -> int:
    return sum(
        1
        for outcome in outcomes
        for strike in outcome.expected_strike_outcomes
        if strike.result == PerformanceExpectedStrikeResult.MISSING
    )


def _unexpected_pitch_count(outcomes: Sequence[PerformanceExpectedEventOutcome]) -> int:
    return sum(len(outcome.unexpected_pitches) for outcome in outcomes)


def _measure_payload(
    measure_number: str,
    targets: Sequence[PracticeSessionSummaryTargetPayload],
) -> PracticeSessionSummaryProblemMeasurePayload:
    target_count = len(targets)
    completed_target_count = sum(1 for target in targets if target["completed"])
    incomplete_target_count = target_count - completed_target_count
    attempt_count = sum(target["attempt_count"] for target in targets)
    scorable_attempt_count = sum(target["scorable_attempt_count"] for target in targets)
    interrupted_attempt_count = sum(target["interrupted_attempt_count"] for target in targets)
    skipped_attempt_count = sum(target["skipped_attempt_count"] for target in targets)
    partial_attempt_count = sum(target["partial_attempt_count"] for target in targets)
    mismatch_attempt_count = sum(target["mismatch_attempt_count"] for target in targets)
    scorable_targets = [
        target for target in targets if target["scorable_attempt_count"] > 0
    ]
    confidences = [
        target["last_confidence"]
        for target in scorable_targets
    ]
    average_confidence = (
        round(sum(confidences) / len(confidences), 3)
        if confidences
        else None
    )
    return {
        "measure_number": measure_number,
        "target_count": target_count,
        "completed_target_count": completed_target_count,
        "incomplete_target_count": incomplete_target_count,
        "attempt_count": attempt_count,
        "scorable_attempt_count": scorable_attempt_count,
        "interrupted_attempt_count": interrupted_attempt_count,
        "skipped_attempt_count": skipped_attempt_count,
        "partial_attempt_count": partial_attempt_count,
        "mismatch_attempt_count": mismatch_attempt_count,
        "average_confidence": average_confidence,
    }


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
