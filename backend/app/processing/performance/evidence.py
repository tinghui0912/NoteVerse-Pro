from __future__ import annotations

import array
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import Enum

from app.db.models import (
    PracticeInputSource,
    PracticeSession,
    PracticeSessionCompletionReason,
)


PERFORMANCE_EVIDENCE_SUMMARY_VERSION = "performance-evidence-summary-v1"
CONFIDENT_OBSERVATION_THRESHOLD = 0.75
MICROPHONE_ACTIVE_RMS_FLOOR = 0.01
MICROPHONE_CONFIDENT_RMS = 0.05
MICROPHONE_CLIPPING_PEAK = 0.98


class PerformanceObservationSource(str, Enum):
    MICROPHONE = "MICROPHONE"
    MIDI = "MIDI"


class PerformanceExpectedEventResult(str, Enum):
    MATCH = "MATCH"
    PARTIAL = "PARTIAL"
    MISMATCH = "MISMATCH"
    UNCERTAIN = "UNCERTAIN"
    NOT_OBSERVED = "NOT_OBSERVED"


class PerformanceExpectedStrikeResult(str, Enum):
    MATCHED = "MATCHED"
    MISSING = "MISSING"
    UNCONFIRMED = "UNCONFIRMED"


def midi_pitch_name(note_number: int) -> str:
    if note_number < 0 or note_number > 127:
        raise ValueError("MIDI note number must be between 0 and 127.")
    pitch_classes = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    octave = note_number // 12 - 1
    return f"{pitch_classes[note_number % 12]}{octave}"


@dataclass(frozen=True)
class PerformanceObservation:
    """Input evidence normalized onto the Performance session timebase."""

    source: PerformanceObservationSource
    session_time_ms: int
    performance_time_ms: float
    duration_ms: int
    active: bool
    analyzable: bool
    confidence: float
    observed_pitches: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.session_time_ms < 0:
            raise ValueError("Performance observation session time must be non-negative.")
        if self.performance_time_ms < 0:
            raise ValueError("Performance observation time must be non-negative.")
        if self.duration_ms <= 0:
            raise ValueError("Performance observation duration must be positive.")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("Performance observation confidence must be between 0 and 1.")


@dataclass(frozen=True)
class PerformanceExpectedStrikeOutcome:
    strike_id: str
    pitch: str
    render_note_ids: tuple[str, ...]
    result: PerformanceExpectedStrikeResult

    def __post_init__(self) -> None:
        if not self.strike_id:
            raise ValueError("Performance expected-strike outcome requires a strike id.")
        if not self.pitch:
            raise ValueError("Performance expected-strike outcome requires a pitch.")
        if not self.render_note_ids:
            raise ValueError("Performance expected-strike outcome requires render note ids.")


@dataclass(frozen=True)
class PerformanceExpectedEventOutcome:
    expected_group_id: str
    performance_time_ms: float
    result: PerformanceExpectedEventResult
    confidence: float
    source: PerformanceObservationSource
    expected_strike_outcomes: tuple[PerformanceExpectedStrikeOutcome, ...] = ()
    unexpected_pitches: tuple[str, ...] = ()
    render_note_ids: tuple[str, ...] = ()
    measure_numbers: tuple[str, ...] = ()
    timing_offset_ms: float | None = None

    def __post_init__(self) -> None:
        if not self.expected_group_id:
            raise ValueError("Performance expected-event outcome requires an expected group id.")
        if self.performance_time_ms < 0:
            raise ValueError("Performance expected-event outcome time must be non-negative.")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("Performance expected-event outcome confidence must be between 0 and 1.")


@dataclass
class PerformanceSummaryAccumulator:
    completion_reason: PracticeSessionCompletionReason | None
    input_source: PracticeInputSource
    scope_kind: str
    active_duration_ms: int | None
    observations: list[PerformanceObservation] = field(default_factory=list)
    outcomes: list[PerformanceExpectedEventOutcome] = field(default_factory=list)

    @classmethod
    def from_session(
        cls,
        session: PracticeSession,
        *,
        observations: Iterable[PerformanceObservation] = (),
        outcomes: Iterable[PerformanceExpectedEventOutcome] = (),
    ) -> "PerformanceSummaryAccumulator":
        return cls(
            completion_reason=session.completion_reason,
            input_source=session.input_source,
            scope_kind=_scope_kind(session),
            active_duration_ms=_session_duration_ms(session),
            observations=list(observations),
            outcomes=list(outcomes),
        )

    def add_observation(self, observation: PerformanceObservation) -> None:
        if observation.source.value != self.input_source.value:
            raise ValueError("Performance observation source must match the practice input source.")
        self.observations.append(observation)

    def add_outcome(self, outcome: PerformanceExpectedEventOutcome) -> None:
        if outcome.source.value != self.input_source.value:
            raise ValueError("Performance expected-event outcome source must match the practice input source.")
        self.outcomes.append(outcome)

    def metrics(self) -> dict[str, int | float | str | None]:
        observed_duration_ms = sum(item.duration_ms for item in self.observations)
        active_observation_ms = sum(item.duration_ms for item in self.observations if item.active)
        analyzable_observation_ms = sum(item.duration_ms for item in self.observations if item.analyzable)
        confident_observation_ms = sum(
            item.duration_ms
            for item in self.observations
            if item.active and item.analyzable and item.confidence >= CONFIDENT_OBSERVATION_THRESHOLD
        )
        uncertain_observation_ms = sum(
            item.duration_ms
            for item in self.observations
            if item.active and (not item.analyzable or item.confidence < CONFIDENT_OBSERVATION_THRESHOLD)
        )
        timing_offsets = [
            outcome.timing_offset_ms
            for outcome in self.outcomes
            if outcome.timing_offset_ms is not None
        ]

        return {
            "summary_policy_version": PERFORMANCE_EVIDENCE_SUMMARY_VERSION,
            "completion_reason": self.completion_reason.value if self.completion_reason else None,
            "scope_kind": self.scope_kind,
            "input_source": self.input_source.value,
            "active_duration_seconds": _seconds(self.active_duration_ms),
            "observed_duration_seconds": _seconds(observed_duration_ms),
            "input_activity_coverage": _coverage(active_observation_ms, self.active_duration_ms),
            "analyzable_coverage": _coverage(analyzable_observation_ms, self.active_duration_ms),
            "confident_coverage": _coverage(confident_observation_ms, self.active_duration_ms),
            "uncertain_coverage": _coverage(uncertain_observation_ms, self.active_duration_ms),
            "expected_outcome_count": len(self.outcomes),
            "matched_expected_groups": _outcome_count(self.outcomes, PerformanceExpectedEventResult.MATCH),
            "partial_expected_groups": _outcome_count(self.outcomes, PerformanceExpectedEventResult.PARTIAL),
            "mismatched_expected_groups": _outcome_count(self.outcomes, PerformanceExpectedEventResult.MISMATCH),
            "uncertain_expected_groups": _outcome_count(self.outcomes, PerformanceExpectedEventResult.UNCERTAIN),
            "not_observed_expected_groups": _outcome_count(
                self.outcomes,
                PerformanceExpectedEventResult.NOT_OBSERVED,
            ),
            "average_timing_offset_ms": _average(timing_offsets),
            "average_absolute_timing_offset_ms": _average(abs(item) for item in timing_offsets),
        }

class PerformanceEvidenceRecorder:
    def __init__(
        self,
        *,
        source: PerformanceObservationSource,
        sample_rate: int,
        channels: int,
    ) -> None:
        if sample_rate <= 0:
            raise ValueError("Performance evidence sample rate must be positive.")
        if channels <= 0:
            raise ValueError("Performance evidence channels must be positive.")
        self._source = source
        self._sample_rate = sample_rate
        self._channels = channels
        self._active_midi_notes: dict[int, tuple[int, float, str]] = {}
        self._observations: list[PerformanceObservation] = []

    @property
    def observations(self) -> tuple[PerformanceObservation, ...]:
        return tuple(self._observations)

    def record_audio_chunk(
        self,
        chunk: bytes,
        *,
        session_time_ms: int,
        performance_time_ms: float,
    ) -> PerformanceObservation | None:
        if self._source != PerformanceObservationSource.MICROPHONE:
            raise RuntimeError("Audio chunks require a microphone Performance evidence recorder.")
        if not chunk:
            return None

        signal = _pcm_s16le_signal(chunk)
        frame_count = signal.sample_count / self._channels
        duration_ms = max(1, round(frame_count / self._sample_rate * 1000))
        active = signal.rms >= MICROPHONE_ACTIVE_RMS_FLOOR
        analyzable = active and signal.peak < MICROPHONE_CLIPPING_PEAK
        confidence = 0.0 if not active else min(1.0, signal.rms / MICROPHONE_CONFIDENT_RMS)
        observation = PerformanceObservation(
            source=PerformanceObservationSource.MICROPHONE,
            session_time_ms=session_time_ms,
            performance_time_ms=performance_time_ms,
            duration_ms=duration_ms,
            active=active,
            analyzable=analyzable,
            confidence=confidence,
        )
        self._observations.append(observation)
        return observation

    def record_midi_event(
        self,
        *,
        event_type: str,
        note_number: int,
        velocity: int,
        session_time_ms: int,
        performance_time_ms: float,
    ) -> PerformanceObservation | None:
        if self._source != PerformanceObservationSource.MIDI:
            raise RuntimeError("MIDI events require a MIDI Performance evidence recorder.")
        if velocity < 0 or velocity > 127:
            raise ValueError("MIDI velocity must be between 0 and 127.")

        if event_type == "note_on" and velocity > 0:
            self._active_midi_notes[note_number] = (
                session_time_ms,
                performance_time_ms,
                midi_pitch_name(note_number),
            )
            return None
        if event_type not in {"note_off", "note_on"}:
            raise ValueError("Unsupported MIDI event type.")

        started = self._active_midi_notes.pop(note_number, None)
        if started is None:
            return None
        started_at_ms, started_performance_time_ms, pitch = started
        duration_ms = max(1, session_time_ms - started_at_ms)
        observation = PerformanceObservation(
            source=PerformanceObservationSource.MIDI,
            session_time_ms=started_at_ms,
            performance_time_ms=started_performance_time_ms,
            duration_ms=duration_ms,
            active=True,
            analyzable=True,
            confidence=1.0,
            observed_pitches=(pitch,),
        )
        self._observations.append(observation)
        return observation

    def finish_open_midi_notes(
        self,
        *,
        session_time_ms: int,
        performance_time_ms: float,
    ) -> tuple[PerformanceObservation, ...]:
        if self._source != PerformanceObservationSource.MIDI:
            return ()
        observations: list[PerformanceObservation] = []
        for note_number in sorted(self._active_midi_notes):
            started_at_ms, started_performance_time_ms, pitch = self._active_midi_notes[note_number]
            observation = PerformanceObservation(
                source=PerformanceObservationSource.MIDI,
                session_time_ms=started_at_ms,
                performance_time_ms=started_performance_time_ms,
                duration_ms=max(1, session_time_ms - started_at_ms),
                active=True,
                analyzable=True,
                confidence=1.0,
                observed_pitches=(pitch,),
            )
            observations.append(observation)
            self._observations.append(observation)
        self._active_midi_notes.clear()
        return tuple(observations)


def _scope_kind(session: PracticeSession) -> str:
    if session.scope_start_expected_group_id or session.scope_end_expected_group_id:
        return "SELECTED_RANGE"
    return "FULL_PIECE"


def _session_duration_ms(session: PracticeSession) -> int | None:
    if session.started_at is None or session.finished_at is None:
        return None
    duration_seconds = max(0.0, (session.finished_at - session.started_at).total_seconds())
    return round(duration_seconds * 1000)


def _seconds(duration_ms: int | None) -> float | None:
    if duration_ms is None:
        return None
    return round(max(duration_ms, 0) / 1000, 3)


def _coverage(numerator_ms: int, denominator_ms: int | None) -> float | None:
    if denominator_ms is None:
        return None
    if denominator_ms <= 0:
        return 0.0
    return round(min(max(numerator_ms / denominator_ms, 0.0), 1.0), 3)


def _outcome_count(
    outcomes: Iterable[PerformanceExpectedEventOutcome],
    result: PerformanceExpectedEventResult,
) -> int:
    return sum(1 for outcome in outcomes if outcome.result == result)


def _average(values: Iterable[float]) -> float | None:
    items = list(values)
    if not items:
        return None
    return round(sum(items) / len(items), 3)


@dataclass(frozen=True)
class _PcmSignal:
    sample_count: int
    rms: float
    peak: float


def _pcm_s16le_signal(chunk: bytes) -> _PcmSignal:
    samples = array.array("h")
    samples.frombytes(chunk[: len(chunk) - (len(chunk) % 2)])
    if not samples:
        return _PcmSignal(sample_count=0, rms=0.0, peak=0.0)

    scale = 32768.0
    square_sum = 0.0
    peak = 0.0
    for sample in samples:
        normalized = abs(sample) / scale
        square_sum += normalized * normalized
        peak = max(peak, normalized)
    return _PcmSignal(
        sample_count=len(samples),
        rms=(square_sum / len(samples)) ** 0.5,
        peak=peak,
    )
