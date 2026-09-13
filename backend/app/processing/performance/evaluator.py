from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    PracticeScoreTimeline,
)
from app.processing.performance.evidence import (
    PerformanceExpectedEventOutcome,
    PerformanceExpectedEventResult,
    PerformanceExpectedStrikeOutcome,
    PerformanceExpectedStrikeResult,
    PerformanceObservation,
    PerformanceObservationSource,
)
from app.processing.performance.timeline import PerformanceTimeline, ResolvedPerformanceScope


DEFAULT_MIDI_EVENT_ASSIGNMENT_WINDOW_MS = 250.0
DEFAULT_MIDI_CHORD_SIMULTANEITY_WINDOW_MS = 120.0


@dataclass(frozen=True)
class ExpectedPerformanceEvent:
    expected_group: ExpectedPracticeGroup
    performance_time_ms: float


class PerformanceExpectedEventEvaluator:
    def __init__(
        self,
        *,
        score_timeline: PracticeScoreTimeline,
        timeline: PerformanceTimeline,
        scope: ResolvedPerformanceScope,
        midi_event_assignment_window_ms: float = DEFAULT_MIDI_EVENT_ASSIGNMENT_WINDOW_MS,
        midi_chord_simultaneity_window_ms: float = DEFAULT_MIDI_CHORD_SIMULTANEITY_WINDOW_MS,
    ) -> None:
        if midi_event_assignment_window_ms <= 0:
            raise ValueError("MIDI event assignment window must be positive.")
        if midi_chord_simultaneity_window_ms <= 0:
            raise ValueError("MIDI chord simultaneity window must be positive.")
        self._events = _expected_events_for_scope(
            score_timeline=score_timeline,
            timeline=timeline,
            scope=scope,
        )
        self._midi_event_assignment_window_ms = midi_event_assignment_window_ms
        self._midi_chord_simultaneity_window_ms = midi_chord_simultaneity_window_ms

    def evaluate_midi(
        self,
        observations: Sequence[PerformanceObservation],
    ) -> tuple[PerformanceExpectedEventOutcome, ...]:
        if not self._events:
            return ()

        assignments: dict[str, list[PerformanceObservation]] = {
            event.expected_group.group_id: [] for event in self._events
        }
        for observation in observations:
            if observation.source != PerformanceObservationSource.MIDI:
                raise ValueError("MIDI Performance evaluation requires MIDI observations.")
            if not observation.active or not observation.analyzable or not observation.observed_pitches:
                continue
            nearest = _nearest_event_within_assignment_window(
                self._events,
                observation,
                assignment_window_ms=self._midi_event_assignment_window_ms,
            )
            if nearest is not None:
                assignments[nearest.expected_group.group_id].append(observation)

        outcomes: list[PerformanceExpectedEventOutcome] = []
        for event in self._events:
            group_observations = assignments[event.expected_group.group_id]
            outcomes.append(
                _outcome_for_event(
                    event,
                    group_observations,
                    chord_simultaneity_window_ms=self._midi_chord_simultaneity_window_ms,
                )
            )
        return tuple(outcomes)


def _expected_events_for_scope(
    *,
    score_timeline: PracticeScoreTimeline,
    timeline: PerformanceTimeline,
    scope: ResolvedPerformanceScope,
) -> tuple[ExpectedPerformanceEvent, ...]:
    groups = score_timeline.expected_practice_groups
    if not groups:
        return ()

    start_index = _group_index(groups, scope.start_group_id) if scope.start_group_id else 0
    end_index = _group_index(groups, scope.end_group_id) if scope.end_group_id else len(groups) - 1
    return tuple(
        ExpectedPerformanceEvent(
            expected_group=group,
            performance_time_ms=timeline.beat_to_time_ms(group.onset_beat) - scope.nominal_start_time_ms,
        )
        for group in groups[start_index : end_index + 1]
    )


def _outcome_for_event(
    event: ExpectedPerformanceEvent,
    observations: Sequence[PerformanceObservation],
    *,
    chord_simultaneity_window_ms: float,
) -> PerformanceExpectedEventOutcome:
    if not observations:
        return PerformanceExpectedEventOutcome(
            expected_group_id=event.expected_group.group_id,
            performance_time_ms=event.performance_time_ms,
            result=PerformanceExpectedEventResult.NOT_OBSERVED,
            confidence=0.0,
            source=PerformanceObservationSource.MIDI,
            expected_strike_outcomes=tuple(
                PerformanceExpectedStrikeOutcome(
                    strike_id=strike.strike_id,
                    pitch=strike.pitch,
                    render_note_ids=strike.render_note_ids,
                    result=PerformanceExpectedStrikeResult.UNCONFIRMED,
                )
                for strike in event.expected_group.strike_targets
            ),
            render_note_ids=event.expected_group.render_note_ids,
            measure_numbers=event.expected_group.measure_numbers,
        )

    gesture_observations, non_gesture_observations = _split_chord_gesture_observations(
        observations,
        chord_simultaneity_window_ms=chord_simultaneity_window_ms,
    )
    observed_pitches = _observed_pitches(gesture_observations)
    non_gesture = _classify_non_gesture_pitches(
        event,
        _observed_pitches(non_gesture_observations),
        matched_gesture_pitches=observed_pitches,
    )
    expected_strike_outcomes = _expected_strike_outcomes(
        event,
        observed_pitches=observed_pitches,
        unconfirmed_expected_pitches=non_gesture.unconfirmed_expected_pitches,
    )
    unexpected_pitches = _unexpected_pitches(event, observed_pitches) + non_gesture.unexpected_pitches
    timing_offset_ms = _average(
        observation.performance_time_ms - event.performance_time_ms
        for observation in gesture_observations
    )
    confidence = _average(observation.confidence for observation in gesture_observations)
    all_expected_strikes_matched = all(
        strike.result == PerformanceExpectedStrikeResult.MATCHED
        for strike in expected_strike_outcomes
    )
    any_expected_strike_matched = any(
        strike.result == PerformanceExpectedStrikeResult.MATCHED
        for strike in expected_strike_outcomes
    )
    if all_expected_strikes_matched and not unexpected_pitches:
        result = PerformanceExpectedEventResult.MATCH
    elif any_expected_strike_matched and not unexpected_pitches:
        result = PerformanceExpectedEventResult.PARTIAL
    else:
        result = PerformanceExpectedEventResult.MISMATCH

    return PerformanceExpectedEventOutcome(
        expected_group_id=event.expected_group.group_id,
        performance_time_ms=event.performance_time_ms,
        result=result,
        confidence=round(confidence, 3),
        source=PerformanceObservationSource.MIDI,
        expected_strike_outcomes=expected_strike_outcomes,
        unexpected_pitches=unexpected_pitches,
        render_note_ids=event.expected_group.render_note_ids,
        measure_numbers=event.expected_group.measure_numbers,
        timing_offset_ms=round(timing_offset_ms, 3),
    )


def _nearest_event_within_assignment_window(
    events: Sequence[ExpectedPerformanceEvent],
    observation: PerformanceObservation,
    *,
    assignment_window_ms: float,
) -> ExpectedPerformanceEvent | None:
    nearest = min(
        events,
        key=lambda event: abs(event.performance_time_ms - observation.performance_time_ms),
    )
    if abs(nearest.performance_time_ms - observation.performance_time_ms) > assignment_window_ms:
        return None
    return nearest


def _split_chord_gesture_observations(
    observations: Sequence[PerformanceObservation],
    *,
    chord_simultaneity_window_ms: float,
) -> tuple[tuple[PerformanceObservation, ...], tuple[PerformanceObservation, ...]]:
    ordered = tuple(sorted(observations, key=lambda observation: observation.performance_time_ms))
    if not ordered:
        return (), ()

    gesture_start_ms = ordered[0].performance_time_ms
    gesture: list[PerformanceObservation] = []
    non_gesture: list[PerformanceObservation] = []
    for observation in ordered:
        if observation.performance_time_ms - gesture_start_ms <= chord_simultaneity_window_ms:
            gesture.append(observation)
        else:
            non_gesture.append(observation)
    return tuple(gesture), tuple(non_gesture)


def _observed_pitches(
    observations: Sequence[PerformanceObservation],
) -> tuple[str, ...]:
    return tuple(pitch for observation in observations for pitch in observation.observed_pitches)


def _expected_strike_outcomes(
    event: ExpectedPerformanceEvent,
    *,
    observed_pitches: tuple[str, ...],
    unconfirmed_expected_pitches: tuple[str, ...] = (),
) -> tuple[PerformanceExpectedStrikeOutcome, ...]:
    observed_pitch_set = set(observed_pitches)
    unconfirmed_pitch_set = set(unconfirmed_expected_pitches)
    strike_outcomes: list[PerformanceExpectedStrikeOutcome] = []
    for strike in event.expected_group.strike_targets:
        if strike.pitch in observed_pitch_set:
            result = PerformanceExpectedStrikeResult.MATCHED
        elif strike.pitch in unconfirmed_pitch_set:
            result = PerformanceExpectedStrikeResult.UNCONFIRMED
        else:
            result = PerformanceExpectedStrikeResult.MISSING
        strike_outcomes.append(
            PerformanceExpectedStrikeOutcome(
                strike_id=strike.strike_id,
                pitch=strike.pitch,
                render_note_ids=strike.render_note_ids,
                result=result,
            )
        )
    return tuple(strike_outcomes)


def _unexpected_pitches(
    event: ExpectedPerformanceEvent,
    observed_pitches: tuple[str, ...],
) -> tuple[str, ...]:
    expected_pitch_set = {strike.pitch for strike in event.expected_group.strike_targets}
    seen_expected_pitches: set[str] = set()
    unexpected: list[str] = []
    for pitch in observed_pitches:
        if pitch not in expected_pitch_set:
            unexpected.append(pitch)
            continue
        if pitch in seen_expected_pitches:
            unexpected.append(pitch)
            continue
        seen_expected_pitches.add(pitch)
    return tuple(unexpected)


@dataclass(frozen=True)
class NonGesturePitchClassification:
    unconfirmed_expected_pitches: tuple[str, ...]
    unexpected_pitches: tuple[str, ...]


def _classify_non_gesture_pitches(
    event: ExpectedPerformanceEvent,
    observed_pitches: tuple[str, ...],
    *,
    matched_gesture_pitches: tuple[str, ...],
) -> NonGesturePitchClassification:
    expected_pitch_set = {strike.pitch for strike in event.expected_group.strike_targets}
    matched_pitch_set = set(matched_gesture_pitches)
    unconfirmed: list[str] = []
    unexpected: list[str] = []
    for pitch in observed_pitches:
        if pitch not in expected_pitch_set:
            unexpected.append(pitch)
            continue
        if pitch in matched_pitch_set:
            unexpected.append(pitch)
            continue
        if pitch not in unconfirmed:
            unconfirmed.append(pitch)
    return NonGesturePitchClassification(
        unconfirmed_expected_pitches=tuple(unconfirmed),
        unexpected_pitches=tuple(unexpected),
    )


def _group_index(groups: Sequence[ExpectedPracticeGroup], group_id: str) -> int:
    for index, group in enumerate(groups):
        if group.group_id == group_id:
            return index
    raise ValueError(f"Performance scope target not found: {group_id}")


def _average(values) -> float:
    items = list(values)
    if not items:
        return 0.0
    return sum(items) / len(items)
