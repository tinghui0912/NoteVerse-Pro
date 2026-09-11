"""Replay current production STEP microphone chain with layer diagnostics.

This script intentionally does not tune thresholds or change recognition logic.
It feeds WAV audio in production-sized chunks through:

BrowserAudioStreamAdapter -> ExpectedGroupAttemptAccumulator ->
AcousticEventObserver -> ExpectedEventEvaluator -> FollowPolicy.

Some cases use existing real fixtures directly. Cases that need recordings not
yet present in the repo are reported as missing instead of being replaced with
synthetic audio.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Literal
import wave

import numpy as np

from app.processing.engines.practice_alignment.acoustic_event_observation import (
    AcousticEventObserver,
)
from app.processing.engines.practice_alignment.browser_audio_stream import (
    BrowserAudioStreamAdapter,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    PracticeEventEvaluation,
)
from app.processing.engines.practice_alignment.expected_group_attempt_accumulator import (
    ExpectedGroupAttemptAccumulator,
)
from app.processing.engines.practice_alignment.follow_policy import (
    follow_policy_for_progression,
)
from app.processing.engines.practice_alignment.matchmaker_live import (
    WAIT_FOR_NOTE_AUDIO_WINDOW_SECONDS,
    WAIT_FOR_NOTE_COLLECTION_FRAMES,
    WAIT_FOR_NOTE_RELEASE_FRAME_THRESHOLD,
)
from app.processing.engines.practice_alignment.profile import (
    DEFAULT_PRACTICE_AUDIO_PROFILE,
)
from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)


SAMPLE_RATE = 16000
FIXTURE_ROOT = Path("tests/fixtures/practice_audio")
PUBLIC_SAMPLE_ROOT = FIXTURE_ROOT / "public_samples"

FailureCode = Literal[
    "NONE",
    "MISSING_REQUIRED_FIXTURE",
    "FALSE_ATTACK_OPEN",
    "INTERVENING_PHYSICAL_STRIKE",
    "EARLY_FALSE_ADVANCE",
    "ATTACK_MISSED",
    "ATTEMPT_BOUNDARY_ERROR",
    "PITCH_FALSE_POSITIVE",
    "PITCH_FALSE_NEGATIVE",
    "OCTAVE_CONFUSION",
    "SEMITONE_CONFUSION",
    "MISSING_NOTE_FALSE_COMPLETION",
    "PEDAL_TAIL_FALSE_COMPLETION",
    "RETRIGGER_MISSED",
    "NOISE_FALSE_COMPLETION",
]
PHYSICAL_STRIKE_ATTEMPT_TOLERANCE_MS = 120
FixtureStatus = Literal[
    "real_fixture",
    "derived_from_real_fixture",
    "missing_required_fixture",
    "public_dataset_case",
]


class FeaturePassthroughProcessor:
    """Small feature processor so BrowserAudioStreamAdapter can run unchanged."""

    def __call__(self, audio_with_time):
        audio, _feature_time = audio_with_time
        frame = np.asarray(audio, dtype=np.float32)
        if frame.size == 0:
            return np.zeros((1, 4), dtype=np.float32)
        rms = float(np.sqrt(np.mean(np.square(frame))))
        peak = float(np.max(np.abs(frame)))
        mean_abs = float(np.mean(np.abs(frame)))
        zero_crossing = float(np.mean(np.diff(np.signbit(frame)).astype(np.float32)))
        return np.asarray([[rms, peak, mean_abs, zero_crossing]], dtype=np.float32)

    def reset(self) -> None:
        return None


class RecordingObserver(AcousticEventObserver):
    """Production observer with a trace of every PCM observation call."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[dict[str, object]] = []

    def observe_mono_pcm(
        self,
        samples,
        *,
        sample_rate: int,
        np_module,
        onset_beat=None,
    ):
        observation = super().observe_mono_pcm(
            samples,
            sample_rate=sample_rate,
            np_module=np_module,
            onset_beat=onset_beat,
        )
        self.calls.append(
            {
                "observed_pitches": list(observation.observed_pitches),
                "confidence": round(float(observation.confidence), 4),
                "onset_beat": observation.onset_beat,
            }
        )
        return observation


@dataclass(frozen=True)
class CaseSpec:
    case_id: str
    expected_groups: tuple[tuple[str, ...], ...]
    expected_advances: int
    fixture_status: FixtureStatus
    source_paths: tuple[str, ...] = ()
    missing_fixture_request: str | None = None
    padding_before_seconds: float = 1.1
    inter_strike_silence_seconds: float = 0.35
    diagnostic_note: str = ""
    source_metadata: dict[str, object] | None = None


@dataclass(frozen=True)
class AttemptTrace:
    sequence: int
    expected_group_id: str
    started_at_ms: int
    resolved_at_ms: int | None
    observed_pitches: tuple[str, ...]
    observer_confidence: float
    evaluation_result: str
    matched_pitches: tuple[str, ...]
    missing_pitches: tuple[str, ...]
    extra_pitches: tuple[str, ...]
    decision_action: str
    decision_reason: str
    advanced: bool
    decision_latency_ms: int | None
    physical_strike_alignment: str = "NO_GROUND_TRUTH"
    nearest_physical_strike_ms: int | None = None
    nearest_physical_strike_delta_ms: int | None = None
    nearest_physical_strike_pitches: tuple[str, ...] = ()


@dataclass(frozen=True)
class FrameTrace:
    relative_ms: int
    midi_note_on_truth: tuple[str, ...]
    midi_note_off_truth: tuple[str, ...]
    cc64_pedal_state: str | None
    rms: float
    peak: float
    spectral_flatness: float
    peak_prominence: float
    spectral_flux: float
    calibrated_flux_gate: float
    tonal_signal: bool
    onset_signal: bool
    frame_class: str
    stream_started: bool
    runtime_activity_reason: str
    gate_reason: str
    candidate_signal: bool
    start_candidate_signal: bool
    attempt_open: bool
    attempt_sequence: int | None
    attempt_frame_count: int
    release_frames: int
    observer_observed_pitches: tuple[str, ...]
    observer_confidence: float | None
    evaluation: str | None
    advance: bool


@dataclass(frozen=True)
class FailureDetail:
    root_cause: str
    anchor_ms: int | None
    physical_strike_near_failure: bool | None
    nearest_physical_strike_ms: int | None
    nearest_physical_strike_delta_ms: int | None
    physical_pitches: tuple[str, ...]
    expected_pitches: tuple[str, ...]
    observed_pitches: tuple[str, ...]
    matched_pitches: tuple[str, ...]
    evaluation: str | None
    advance: bool
    onset_false: bool | None
    attempt_behavior: str
    spectral_flux: float | None
    calibrated_flux_gate: float | None
    start_candidate_signal: bool | None
    onset_signal: bool | None
    note: str


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    fixture_status: FixtureStatus
    expected_groups: tuple[tuple[str, ...], ...]
    expected_advances: int
    actual_advances: int
    start_gate_triggered: bool
    first_start_gate_ms: int | None
    attempt_opened: bool
    attempt_open_count: int
    attempts: tuple[AttemptTrace, ...]
    last_gate_reason: str
    last_queue_decision: str
    attack_correct: bool | None
    attempt_correct: bool | None
    pitch_correct: bool | None
    evaluation: str
    advance: bool
    primary_failure: FailureCode
    diagnostic_note: str
    boundary_note: str
    source_metadata: dict[str, object] | None = None
    physical_attempt_summary: dict[str, int] | None = None
    retrigger_audit: dict[str, object] | None = None
    timeline: tuple[dict[str, object], ...] = ()
    failure_detail: FailureDetail | None = None
    failure_frame_trace: tuple[FrameTrace, ...] = ()
    missing_fixture_request: str | None = None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/work/datasets/production_step_microphone_causal_replay_report.json"),
    )
    parser.add_argument(
        "--case-manifest",
        type=Path,
        default=None,
        help="Optional public-dataset causal case manifest produced by the extractor.",
    )
    args = parser.parse_args()

    cases = _case_specs_from_manifest(args.case_manifest) if args.case_manifest else _case_specs()
    results = tuple(_run_case(case) for case in cases)
    payload = {
        "benchmark_scope": "production_step_microphone_causal_replay",
        "recognition_chain": [
            "BrowserAudioStreamAdapter",
            "ExpectedGroupAttemptAccumulator",
            "AcousticEventObserver",
            "ExpectedEventEvaluator",
            "FollowPolicy",
        ],
        "constraints": {
            "oracle_onset": False,
            "midi_truth_visible_to_recognizer": False,
            "future_audio_visible_to_recognizer": False,
            "algorithm_changes": False,
        },
        "known_limitation": (
            "The standalone harness uses the production audio activity and attempt/evaluator "
            "chain, but uses a neutral start-feature scorer instead of full score-reference "
            "startup validation. Cases marked derived_from_real_fixture are diagnostics, not "
            "a substitute for same-take product validation recordings."
        ),
        "case_manifest": str(args.case_manifest) if args.case_manifest else None,
        "summary": _summary(results),
        "results": [asdict(result) for result in results],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(_markdown_table(results))
    print(f"\nWrote {args.output}")


def _case_specs() -> tuple[CaseSpec, ...]:
    return (
        CaseSpec(
            case_id="correct_single_note_c4",
            expected_groups=(("C4",),),
            expected_advances=1,
            fixture_status="real_fixture",
            source_paths=("public_samples/piano_uiowa_mf_c4_16k.wav",),
        ),
        CaseSpec(
            case_id="wrong_octave_c5_for_c4",
            expected_groups=(("C4",),),
            expected_advances=0,
            fixture_status="real_fixture",
            source_paths=("public_samples/piano_uiowa_mf_c5_16k.wav",),
        ),
        CaseSpec(
            case_id="wrong_semitone_for_c4",
            expected_groups=(("C4",),),
            expected_advances=0,
            fixture_status="missing_required_fixture",
            missing_fixture_request=(
                "Record a real piano B3 or C#4 strike while the expected target is C4."
            ),
        ),
        CaseSpec(
            case_id="missing_chord_note_c4_for_c4_c5",
            expected_groups=(("C4", "C5"),),
            expected_advances=0,
            fixture_status="derived_from_real_fixture",
            source_paths=("public_samples/piano_uiowa_mf_c4_16k.wav",),
            diagnostic_note=(
                "Uses a real C4 single-note recording against a C4+C5 expected chord. "
                "A same-take real missing-chord fixture is still required."
            ),
        ),
        CaseSpec(
            case_id="sustain_tail_without_new_strike",
            expected_groups=(("C4",), ("C4",)),
            expected_advances=1,
            fixture_status="real_fixture",
            source_paths=("public_samples/piano_uiowa_mf_c4_16k.wav",),
            diagnostic_note=(
                "Second target is presented while the original real C4 recording decays; "
                "no second source strike is added."
            ),
        ),
        CaseSpec(
            case_id="same_note_retrigger_c4",
            expected_groups=(("C4",), ("C4",)),
            expected_advances=2,
            fixture_status="derived_from_real_fixture",
            source_paths=(
                "public_samples/piano_uiowa_mf_c4_16k.wav",
                "public_samples/piano_uiowa_mf_c4_16k.wav",
            ),
            diagnostic_note=(
                "Built from two copies of a real C4 fixture separated by silence. "
                "A real same-note retrigger recording is still required."
            ),
        ),
        CaseSpec(
            case_id="noise_desk_knock_for_c4",
            expected_groups=(("C4",),),
            expected_advances=0,
            fixture_status="real_fixture",
            source_paths=("public_samples/desk_knock_esc50_16k.wav",),
        ),
    )


def _run_case(case: CaseSpec) -> CaseResult:
    if case.fixture_status == "missing_required_fixture":
        return CaseResult(
            case_id=case.case_id,
            fixture_status=case.fixture_status,
            expected_groups=case.expected_groups,
            expected_advances=case.expected_advances,
            actual_advances=0,
            start_gate_triggered=False,
            first_start_gate_ms=None,
            attempt_opened=False,
            attempt_open_count=0,
            attempts=(),
            last_gate_reason="missing_fixture",
            last_queue_decision="missing_fixture",
            attack_correct=None,
            attempt_correct=None,
            pitch_correct=None,
            evaluation="NOT_RUN",
            advance=False,
            primary_failure="MISSING_REQUIRED_FIXTURE",
            diagnostic_note=case.diagnostic_note,
            boundary_note="",
            source_metadata=case.source_metadata,
            physical_attempt_summary=None,
            retrigger_audit=None,
            timeline=(),
            failure_detail=None,
            failure_frame_trace=(),
            missing_fixture_request=case.missing_fixture_request,
        )

    audio = _audio_for_case(case)
    frame_length = int(SAMPLE_RATE / DEFAULT_PRACTICE_AUDIO_PROFILE.frame_rate)
    frames = _split_frames(audio, frame_length)
    stream = _build_stream(frame_length)
    observer = RecordingObserver()
    accumulator = ExpectedGroupAttemptAccumulator(
        observer=observer,
        sample_rate=SAMPLE_RATE,
        np_module=np,
        window_samples=int(SAMPLE_RATE * WAIT_FOR_NOTE_AUDIO_WINDOW_SECONDS),
        collection_frames=WAIT_FOR_NOTE_COLLECTION_FRAMES,
        release_frame_threshold=WAIT_FOR_NOTE_RELEASE_FRAME_THRESHOLD,
    )
    timeline = SimpleNamespace(
        expected_practice_groups=tuple(
            _expected_group(pitches, index) for index, pitches in enumerate(case.expected_groups, start=1)
        )
    )
    follow_policy = follow_policy_for_progression(
        timeline,
        progression_mode="WAIT_FOR_NOTE",
        input_source="MICROPHONE",
    )

    attempts: list[AttemptTrace] = []
    actual_advances = 0
    first_start_gate_ms: int | None = None
    attempt_open_count = 0
    previous_open = False
    frame_traces: list[FrameTrace] = []

    for frame_index, frame in enumerate(frames, start=1):
        timestamp_ms = int((frame_index * frame_length / SAMPLE_RATE) * 1000)
        stream.ingest(frame)
        if stream.started and first_start_gate_ms is None:
            first_start_gate_ms = timestamp_ms
        current_group = follow_policy.current_expected_group
        if current_group is None:
            frame_traces.append(
                _frame_trace(
                    case=case,
                    stream=stream,
                    accumulator=accumulator,
                    timestamp_ms=timestamp_ms,
                    frame_length=frame_length,
                    candidate_signal=False,
                    start_candidate_signal=False,
                    attempt_open=False,
                    observer_observed_pitches=(),
                    observer_confidence=None,
                    evaluation=None,
                    advance=False,
                )
            )
            continue

        candidate_signal = _wait_for_note_candidate_signal(stream)
        start_candidate_signal = _wait_for_note_start_candidate_signal(stream)
        before_open = accumulator.open
        observation = accumulator.observe_frame(
            frame,
            candidate_signal=candidate_signal,
            start_candidate_signal=start_candidate_signal,
            onset_beat=current_group.onset_beat,
            expected_group_id=current_group.group_id,
            timestamp_ms=timestamp_ms,
        )
        if accumulator.open and not previous_open:
            attempt_open_count += 1
        opened_this_frame = accumulator.open and not before_open
        previous_open = accumulator.open
        if observation is None:
            frame_traces.append(
                _frame_trace(
                    case=case,
                    stream=stream,
                    accumulator=accumulator,
                    timestamp_ms=timestamp_ms,
                    frame_length=frame_length,
                    candidate_signal=candidate_signal,
                    start_candidate_signal=start_candidate_signal,
                    attempt_open=opened_this_frame,
                    observer_observed_pitches=(),
                    observer_confidence=None,
                    evaluation=None,
                    advance=False,
                )
            )
            continue

        evaluation = follow_policy.evaluate_evidence(EvaluatorEvidence.from_audio(observation))
        decision = follow_policy.decide_evaluation(
            evidence=EvaluatorEvidence.from_audio(observation),
            evaluation=evaluation,
        )
        advanced = decision["action"] == "advance"
        if advanced:
            actual_advances += 1
        frame_traces.append(
            _frame_trace(
                case=case,
                stream=stream,
                accumulator=accumulator,
                timestamp_ms=timestamp_ms,
                frame_length=frame_length,
                candidate_signal=candidate_signal,
                start_candidate_signal=start_candidate_signal,
                attempt_open=opened_this_frame,
                observer_observed_pitches=observation.observed_pitches,
                observer_confidence=observation.confidence,
                evaluation=evaluation.result,
                advance=advanced,
            )
        )
        snapshot = accumulator.last_resolved_attempt
        attempts.append(
            _attempt_trace(
                snapshot=snapshot,
                observation_pitches=observation.observed_pitches,
                observation_confidence=observation.confidence,
                evaluation=evaluation,
                decision=decision,
                advanced=advanced,
            )
        )
        accumulator.reset()
        previous_open = False

    attempts = tuple(_attach_physical_strike_alignment(case, attempts))

    return _classify_case(
        case=case,
        stream=stream,
        first_start_gate_ms=first_start_gate_ms,
        attempt_open_count=attempt_open_count,
        actual_advances=actual_advances,
        attempts=tuple(attempts),
        frame_traces=tuple(frame_traces),
    )


def _build_stream(frame_length: int) -> BrowserAudioStreamAdapter:
    profile = DEFAULT_PRACTICE_AUDIO_PROFILE
    stream = BrowserAudioStreamAdapter(
        processor=FeaturePassthroughProcessor(),
        feature_queue=SimpleNamespace(put=lambda _item: None),
        np=np,
        hop_length=frame_length,
        rms_gate=profile.rms_gate,
        peak_gate=profile.peak_gate,
        start_rms_gate=profile.start_rms_gate,
        start_peak_gate=profile.start_peak_gate,
        min_active_frames=profile.min_active_frames,
        calibration_sample_count=profile.calibration_sample_count(SAMPLE_RATE),
        rms_noise_multiplier=profile.rms_noise_multiplier,
        peak_noise_multiplier=profile.peak_noise_multiplier,
        diagnostics_enabled=False,
        no_input_frames=profile.no_input_frames,
        tonal_gate_enabled=profile.tonal_gate_enabled,
        max_spectral_flatness=profile.max_spectral_flatness,
        min_peak_prominence=profile.min_peak_prominence,
        onset_flux_gate=profile.onset_flux_gate,
        onset_hold_frames=profile.onset_hold_frames,
        start_feature_window_frames=profile.startup_feature_window_frames,
        diagnostic_frame_interval=999999,
    )
    stream.start_feature_scorer = lambda _feature_vector: 1.0
    return stream


def _wait_for_note_candidate_signal(stream: BrowserAudioStreamAdapter) -> bool:
    if getattr(stream, "last_onset_signal", False):
        return True
    gate_config = stream.audio_gate.config
    rms_gate = min(
        stream.start_rms_gate * gate_config.start_rms_ratio,
        stream.rms_gate * gate_config.start_rms_fallback_ratio,
    )
    peak_gate = min(
        stream.start_peak_gate * gate_config.start_peak_ratio,
        stream.peak_gate * gate_config.start_peak_fallback_ratio,
    )
    return getattr(stream, "last_rms", 0.0) >= rms_gate or getattr(stream, "last_peak", 0.0) >= peak_gate


def _wait_for_note_start_candidate_signal(stream: BrowserAudioStreamAdapter) -> bool:
    if not stream.started:
        return _wait_for_note_candidate_signal(stream)
    return bool(getattr(stream, "last_onset_signal", False))


def _attempt_trace(
    *,
    snapshot,
    observation_pitches: tuple[str, ...],
    observation_confidence: float,
    evaluation: PracticeEventEvaluation,
    decision,
    advanced: bool,
) -> AttemptTrace:
    started_at_ms = int(snapshot.started_at_ms) if snapshot is not None else 0
    resolved_at_ms = int(snapshot.resolved_at_ms) if snapshot is not None and snapshot.resolved_at_ms is not None else None
    latency = None if resolved_at_ms is None else resolved_at_ms - started_at_ms
    return AttemptTrace(
        sequence=int(snapshot.attempt_sequence) if snapshot is not None else 0,
        expected_group_id=str(evaluation.expected_group_id),
        started_at_ms=started_at_ms,
        resolved_at_ms=resolved_at_ms,
        observed_pitches=tuple(observation_pitches),
        observer_confidence=round(float(observation_confidence), 4),
        evaluation_result=evaluation.result,
        matched_pitches=evaluation.matched_pitches,
        missing_pitches=evaluation.missing_pitches,
        extra_pitches=evaluation.extra_pitches,
        decision_action=decision["action"],
        decision_reason=decision["reason"],
        advanced=advanced,
        decision_latency_ms=latency,
    )


def _attach_physical_strike_alignment(
    case: CaseSpec,
    attempts: list[AttemptTrace],
) -> tuple[AttemptTrace, ...]:
    note_ons = _physical_note_on_events(case)
    if not note_ons:
        return tuple(attempts)
    enriched: list[AttemptTrace] = []
    for attempt in attempts:
        nearest = min(
            note_ons,
            key=lambda note_on: abs(int(note_on["relative_ms"]) - attempt.started_at_ms),
        )
        delta_ms = attempt.started_at_ms - int(nearest["relative_ms"])
        aligned = abs(delta_ms) <= PHYSICAL_STRIKE_ATTEMPT_TOLERANCE_MS
        enriched.append(
            AttemptTrace(
                sequence=attempt.sequence,
                expected_group_id=attempt.expected_group_id,
                started_at_ms=attempt.started_at_ms,
                resolved_at_ms=attempt.resolved_at_ms,
                observed_pitches=attempt.observed_pitches,
                observer_confidence=attempt.observer_confidence,
                evaluation_result=attempt.evaluation_result,
                matched_pitches=attempt.matched_pitches,
                missing_pitches=attempt.missing_pitches,
                extra_pitches=attempt.extra_pitches,
                decision_action=attempt.decision_action,
                decision_reason=attempt.decision_reason,
                advanced=attempt.advanced,
                decision_latency_ms=attempt.decision_latency_ms,
                physical_strike_alignment=(
                    "TRUE_PHYSICAL_STRIKE_ATTEMPT"
                    if aligned
                    else "FALSE_ATTEMPT_WITHOUT_STRIKE"
                ),
                nearest_physical_strike_ms=int(nearest["relative_ms"]),
                nearest_physical_strike_delta_ms=delta_ms,
                nearest_physical_strike_pitches=tuple(str(pitch) for pitch in nearest["pitches"]),
            )
        )
    return tuple(enriched)


def _classify_case(
    *,
    case: CaseSpec,
    stream: BrowserAudioStreamAdapter,
    first_start_gate_ms: int | None,
    attempt_open_count: int,
    actual_advances: int,
    attempts: tuple[AttemptTrace, ...],
    frame_traces: tuple[FrameTrace, ...],
) -> CaseResult:
    advance = actual_advances > 0
    latest_evaluation = attempts[-1].evaluation_result if attempts else "NO_ATTEMPT"
    case_kind = _case_kind(case)
    expected_any_attack = case.case_id not in {"noise_desk_knock_for_c4"}
    attack_correct = (attempt_open_count > 0) == expected_any_attack
    if case_kind in {"sustain_tail_without_retrigger", "long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"}:
        attempt_correct = attempt_open_count == 1
    elif case_kind == "same_note_retrigger":
        second_start_ms = _second_target_relative_ms(case)
        attempt_correct = (
            attempt_open_count >= 2
            and len(attempts) >= 2
            and second_start_ms is not None
            and attempts[1].started_at_ms >= second_start_ms - 50
        )
    else:
        expected_attempt_count = 0 if not expected_any_attack else 1
        attempt_correct = attempt_open_count == expected_attempt_count
    pitch_correct = _pitch_correct(case, attempts)
    failure = _primary_failure(case, actual_advances, attempts, attempt_open_count, first_start_gate_ms)
    physical_summary = _physical_attempt_summary(attempts)
    retrigger_audit = _retrigger_audit(case, attempts)
    failure_detail = _failure_detail(case, failure, attempts, frame_traces)
    failure_trace = _failure_frame_trace(failure_detail, frame_traces)
    return CaseResult(
        case_id=case.case_id,
        fixture_status=case.fixture_status,
        expected_groups=case.expected_groups,
        expected_advances=case.expected_advances,
        actual_advances=actual_advances,
        start_gate_triggered=first_start_gate_ms is not None,
        first_start_gate_ms=first_start_gate_ms,
        attempt_opened=attempt_open_count > 0,
        attempt_open_count=attempt_open_count,
        attempts=attempts,
        last_gate_reason=str(getattr(stream, "last_gate_reason", "unknown")),
        last_queue_decision=str(getattr(stream, "last_queue_decision", "unknown")),
        attack_correct=attack_correct,
        attempt_correct=attempt_correct,
        pitch_correct=pitch_correct,
        evaluation=latest_evaluation,
        advance=advance,
        primary_failure=failure,
        diagnostic_note=case.diagnostic_note,
        boundary_note=_boundary_note(case, attempts),
        source_metadata=case.source_metadata,
        physical_attempt_summary=physical_summary,
        retrigger_audit=retrigger_audit,
        timeline=_timeline(case, attempts),
        failure_detail=failure_detail,
        failure_frame_trace=failure_trace,
        missing_fixture_request=case.missing_fixture_request,
    )


def _frame_trace(
    *,
    case: CaseSpec,
    stream: BrowserAudioStreamAdapter,
    accumulator: ExpectedGroupAttemptAccumulator,
    timestamp_ms: int,
    frame_length: int,
    candidate_signal: bool,
    start_candidate_signal: bool,
    attempt_open: bool,
    observer_observed_pitches: tuple[str, ...],
    observer_confidence: float | None,
    evaluation: str | None,
    advance: bool,
) -> FrameTrace:
    frame_start_ms = timestamp_ms - int((frame_length / SAMPLE_RATE) * 1000)
    return FrameTrace(
        relative_ms=timestamp_ms,
        midi_note_on_truth=_truth_pitches_in_window(
            _physical_note_on_events(case),
            frame_start_ms,
            timestamp_ms,
        ),
        midi_note_off_truth=_truth_pitches_in_window(
            _physical_note_off_events(case),
            frame_start_ms,
            timestamp_ms,
        ),
        cc64_pedal_state=_pedal_state_at_ms(case, timestamp_ms),
        rms=round(float(getattr(stream, "last_rms", 0.0)), 6),
        peak=round(float(getattr(stream, "last_peak", 0.0)), 6),
        spectral_flatness=round(float(getattr(stream, "last_spectral_flatness", 1.0)), 6),
        peak_prominence=round(float(getattr(stream, "last_peak_prominence", 0.0)), 6),
        spectral_flux=round(float(getattr(stream, "last_spectral_flux", 0.0)), 6),
        calibrated_flux_gate=round(float(getattr(stream, "_calibrated_flux_gate", 0.0)), 6),
        tonal_signal=bool(getattr(stream, "last_tonal_signal", False)),
        onset_signal=bool(getattr(stream, "last_onset_signal", False)),
        frame_class=str(getattr(stream, "last_frame_class", "unknown")),
        stream_started=bool(getattr(stream, "started", False)),
        runtime_activity_reason=str(getattr(stream, "last_runtime_activity_reason", "unknown")),
        gate_reason=str(getattr(stream, "last_gate_reason", "unknown")),
        candidate_signal=candidate_signal,
        start_candidate_signal=start_candidate_signal,
        attempt_open=attempt_open,
        attempt_sequence=_current_attempt_sequence(accumulator),
        attempt_frame_count=int(getattr(accumulator, "frame_count", 0)),
        release_frames=int(getattr(accumulator, "release_frames", 0)),
        observer_observed_pitches=tuple(observer_observed_pitches),
        observer_confidence=(
            None if observer_confidence is None else round(float(observer_confidence), 4)
        ),
        evaluation=evaluation,
        advance=advance,
    )


def _current_attempt_sequence(accumulator: ExpectedGroupAttemptAccumulator) -> int | None:
    current = accumulator.lifecycle.current
    if current is not None:
        return int(current.attempt_sequence)
    resolved = accumulator.last_resolved_attempt
    if resolved is not None:
        return int(resolved.attempt_sequence)
    return None


def _case_specs_from_manifest(path: Path) -> tuple[CaseSpec, ...]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    cases = []
    for item in manifest.get("cases", []):
        audio_path = Path(str(item["audio_path"]))
        if not audio_path.is_absolute():
            audio_path = (path.parent / audio_path).resolve()
        cases.append(
            CaseSpec(
                case_id=str(item["case_id"]),
                expected_groups=tuple(
                    tuple(str(pitch) for pitch in group)
                    for group in item["expected_groups"]
                ),
                expected_advances=int(item["expected_advances"]),
                fixture_status="public_dataset_case",
                source_paths=(str(audio_path),),
                padding_before_seconds=0.0,
                diagnostic_note=str(item.get("diagnostic_note", "")),
                source_metadata={
                    key: value
                    for key, value in item.items()
                    if key
                    not in {
                        "case_id",
                        "expected_groups",
                        "expected_advances",
                        "audio_path",
                        "diagnostic_note",
                    }
                },
            )
        )
    return tuple(cases)


def _pitch_correct(case: CaseSpec, attempts: tuple[AttemptTrace, ...]) -> bool | None:
    if not attempts:
        return None
    case_kind = _case_kind(case)
    if case_kind == "wrong_octave":
        expected = set(case.expected_groups[0])
        return all(expected.isdisjoint(attempt.observed_pitches) for attempt in attempts)
    if case_kind == "wrong_semitone":
        expected = set(case.expected_groups[0])
        return all(expected.isdisjoint(attempt.observed_pitches) for attempt in attempts)
    if case.case_id == "noise_desk_knock_for_c4":
        return all(not attempt.observed_pitches for attempt in attempts)
    if case_kind == "missing_chord_tone":
        return all(attempt.evaluation_result != "MATCH" for attempt in attempts)
    if case_kind in {"sustain_tail_without_retrigger", "long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"}:
        return len(attempts) <= 1
    expected_flat = tuple(pitch for group in case.expected_groups for pitch in group)
    observed_flat = tuple(pitch for attempt in attempts for pitch in attempt.observed_pitches)
    return all(pitch in observed_flat for pitch in expected_flat)


def _primary_failure(
    case: CaseSpec,
    actual_advances: int,
    attempts: tuple[AttemptTrace, ...],
    attempt_open_count: int,
    first_start_gate_ms: int | None,
) -> FailureCode:
    case_kind = _case_kind(case)
    if case.fixture_status == "missing_required_fixture":
        return "MISSING_REQUIRED_FIXTURE"
    if case.case_id == "noise_desk_knock_for_c4":
        if actual_advances > 0:
            return "NOISE_FALSE_COMPLETION"
        if first_start_gate_ms is not None or attempt_open_count > 0:
            return "FALSE_ATTACK_OPEN"
        return "NONE"
    if case_kind == "wrong_octave":
        if actual_advances > 0:
            return "OCTAVE_CONFUSION"
        return "ATTACK_MISSED" if not attempts else "NONE"
    if case_kind == "wrong_semitone":
        return "SEMITONE_CONFUSION" if actual_advances > 0 else "NONE"
    if case_kind == "missing_chord_tone":
        if actual_advances > 0:
            return "MISSING_NOTE_FALSE_COMPLETION"
        return "NONE"
    if case_kind in {"sustain_tail_without_retrigger", "long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"}:
        if actual_advances > 1:
            return "PEDAL_TAIL_FALSE_COMPLETION"
        if attempt_open_count > 1:
            return (
                "FALSE_ATTACK_OPEN"
                if _has_false_attempt_without_physical_strike(attempts)
                else "INTERVENING_PHYSICAL_STRIKE"
            )
        return "NONE"
    if case_kind == "same_note_retrigger":
        second_start_ms = _second_target_relative_ms(case)
        if _has_early_false_advance(attempts, second_start_ms):
            return "EARLY_FALSE_ADVANCE"
        if (
            second_start_ms is not None
            and len(attempts) >= 2
            and attempts[1].started_at_ms < second_start_ms - 50
        ):
            return (
                "FALSE_ATTACK_OPEN"
                if _has_false_attempt_without_physical_strike((attempts[1],))
                else "INTERVENING_PHYSICAL_STRIKE"
            )
        if actual_advances < case.expected_advances:
            return "RETRIGGER_MISSED" if attempt_open_count < case.expected_advances else "PITCH_FALSE_NEGATIVE"
        return "NONE"
    if actual_advances < case.expected_advances:
        return "ATTACK_MISSED" if not attempts else "PITCH_FALSE_NEGATIVE"
    if actual_advances > case.expected_advances:
        return "PITCH_FALSE_POSITIVE"
    return "NONE"


def _has_false_attempt_without_physical_strike(attempts: tuple[AttemptTrace, ...]) -> bool:
    return any(
        attempt.physical_strike_alignment == "FALSE_ATTEMPT_WITHOUT_STRIKE"
        for attempt in attempts
    )


def _has_early_false_advance(
    attempts: tuple[AttemptTrace, ...],
    second_start_ms: int | None,
) -> bool:
    if second_start_ms is None:
        return False
    return any(
        attempt.expected_group_id == "entry-2"
        and attempt.advanced
        and attempt.resolved_at_ms is not None
        and attempt.resolved_at_ms < second_start_ms - 50
        for attempt in attempts
    )


def _boundary_note(case: CaseSpec, attempts: tuple[AttemptTrace, ...]) -> str:
    if _case_kind(case) != "same_note_retrigger" or len(attempts) < 2:
        return ""
    second_start_ms = _second_target_relative_ms(case)
    if second_start_ms is None:
        return ""
    early_advances = [
        attempt
        for attempt in attempts
        if attempt.expected_group_id == "entry-2"
        and attempt.advanced
        and attempt.resolved_at_ms is not None
        and attempt.resolved_at_ms < second_start_ms - 50
    ]
    if early_advances:
        first = early_advances[0]
        return (
            "Second expected target advanced before the second same-pitch source "
            f"strike began at approximately {second_start_ms} ms "
            f"(advance resolved at {first.resolved_at_ms} ms)."
        )
    if attempts[1].started_at_ms < second_start_ms - 50:
        return (
            "An attempt for the second expected target opened before the second "
            f"same-pitch source strike began at approximately {second_start_ms} ms."
        )
    return ""


def _second_target_relative_ms(case: CaseSpec) -> int | None:
    metadata = case.source_metadata or {}
    target_seconds = metadata.get("target_group_seconds")
    time_range = metadata.get("source_time_range_seconds")
    if isinstance(target_seconds, list) and len(target_seconds) >= 2 and isinstance(time_range, list):
        return int(round((float(target_seconds[1]) - float(time_range[0])) * 1000))
    if case.case_id == "same_note_retrigger_c4" and len(case.source_paths) >= 2:
        first_duration_ms = int((_read_fixture(case.source_paths[0]).size / SAMPLE_RATE) * 1000)
        return int(case.padding_before_seconds * 1000) + first_duration_ms + int(
            case.inter_strike_silence_seconds * 1000
        )
    return None


def _physical_note_on_events(case: CaseSpec) -> tuple[dict[str, object], ...]:
    metadata = case.source_metadata or {}
    time_range = metadata.get("source_time_range_seconds")
    events = metadata.get("ground_truth_note_events")
    if not isinstance(time_range, list) or len(time_range) < 2 or not isinstance(events, list):
        return ()
    range_start = float(time_range[0])
    range_end = float(time_range[1])
    grouped: dict[int, list[str]] = {}
    for event in events:
        if not isinstance(event, dict) or "start_seconds" not in event:
            continue
        start_seconds = float(event["start_seconds"])
        if start_seconds < range_start or start_seconds > range_end:
            continue
        relative_ms = int(round((start_seconds - range_start) * 1000))
        grouped.setdefault(relative_ms, []).append(str(event.get("pitch", "unknown")))
    return tuple(
        {"relative_ms": relative_ms, "pitches": tuple(dict.fromkeys(pitches))}
        for relative_ms, pitches in sorted(grouped.items())
    )


def _physical_note_off_events(case: CaseSpec) -> tuple[dict[str, object], ...]:
    metadata = case.source_metadata or {}
    time_range = metadata.get("source_time_range_seconds")
    events = metadata.get("ground_truth_note_events")
    if not isinstance(time_range, list) or len(time_range) < 2 or not isinstance(events, list):
        return ()
    range_start = float(time_range[0])
    range_end = float(time_range[1])
    grouped: dict[int, list[str]] = {}
    for event in events:
        if not isinstance(event, dict) or "end_seconds" not in event:
            continue
        end_seconds = float(event["end_seconds"])
        if end_seconds < range_start or end_seconds > range_end:
            continue
        relative_ms = int(round((end_seconds - range_start) * 1000))
        grouped.setdefault(relative_ms, []).append(str(event.get("pitch", "unknown")))
    return tuple(
        {"relative_ms": relative_ms, "pitches": tuple(dict.fromkeys(pitches))}
        for relative_ms, pitches in sorted(grouped.items())
    )


def _truth_pitches_in_window(
    events: tuple[dict[str, object], ...],
    start_ms: int,
    end_ms: int,
) -> tuple[str, ...]:
    pitches: list[str] = []
    for event in events:
        relative_ms = int(event["relative_ms"])
        if start_ms < relative_ms <= end_ms:
            pitches.extend(str(pitch) for pitch in event["pitches"])
    return tuple(dict.fromkeys(pitches))


def _pedal_state_at_ms(case: CaseSpec, relative_ms: int) -> str | None:
    metadata = case.source_metadata or {}
    time_range = metadata.get("source_time_range_seconds")
    events = metadata.get("ground_truth_pedal_events")
    if not isinstance(time_range, list) or len(time_range) < 2 or not isinstance(events, list):
        return None
    range_start = float(time_range[0])
    state = "up"
    for event in events:
        if not isinstance(event, dict) or "time_seconds" not in event:
            continue
        event_ms = int(round((float(event["time_seconds"]) - range_start) * 1000))
        if event_ms > relative_ms:
            break
        value = float(event.get("value", 0.0))
        state = "down" if value >= 64 else "up"
    return state


def _physical_attempt_summary(attempts: tuple[AttemptTrace, ...]) -> dict[str, int]:
    return dict(Counter(attempt.physical_strike_alignment for attempt in attempts))


def _retrigger_audit(
    case: CaseSpec,
    attempts: tuple[AttemptTrace, ...],
) -> dict[str, object] | None:
    if _case_kind(case) != "same_note_retrigger":
        return None
    metadata = case.source_metadata or {}
    target_seconds = metadata.get("target_group_seconds")
    time_range = metadata.get("source_time_range_seconds")
    if not isinstance(target_seconds, list) or len(target_seconds) < 2 or not isinstance(time_range, list):
        return None
    first_ms = int(round((float(target_seconds[0]) - float(time_range[0])) * 1000))
    second_ms = int(round((float(target_seconds[1]) - float(time_range[0])) * 1000))
    intervening = tuple(
        event
        for event in _physical_note_on_events(case)
        if first_ms < int(event["relative_ms"]) < second_ms
    )
    early_attempts = tuple(
        attempt
        for attempt in attempts
        if attempt.expected_group_id == "entry-2" and attempt.started_at_ms < second_ms - 50
    )
    early_advances = tuple(
        attempt
        for attempt in attempts
        if attempt.expected_group_id == "entry-2"
        and attempt.advanced
        and attempt.resolved_at_ms is not None
        and attempt.resolved_at_ms < second_ms - 50
    )
    second_or_later_advances = tuple(
        attempt
        for attempt in attempts
        if attempt.expected_group_id == "entry-2"
        and attempt.advanced
        and attempt.resolved_at_ms is not None
        and attempt.resolved_at_ms >= second_ms - 50
    )
    return {
        "first_expected_strike_ms": first_ms,
        "second_expected_strike_ms": second_ms,
        "intervening_physical_strikes": intervening,
        "early_attempt_count": len(early_attempts),
        "early_false_advance_count": len(early_advances),
        "retrigger_matched_after_actual_retrigger": bool(second_or_later_advances),
        "retrigger_missed_after_actual_retrigger": not bool(second_or_later_advances),
    }


def _timeline(
    case: CaseSpec,
    attempts: tuple[AttemptTrace, ...],
) -> tuple[dict[str, object], ...]:
    note_on_items = [
        {
            "relative_ms": int(event["relative_ms"]),
            "midi_truth": "note_on",
            "pitch": tuple(event["pitches"]),
        }
        for event in _physical_note_on_events(case)
    ]
    attempt_items = [
        {
            "relative_ms": attempt.started_at_ms,
            "attempt_open": True,
            "expected_group_id": attempt.expected_group_id,
            "observed_pitch": attempt.observed_pitches,
            "evaluation": attempt.evaluation_result,
            "advance": attempt.advanced,
            "resolved_at_ms": attempt.resolved_at_ms,
            "physical_strike_alignment": attempt.physical_strike_alignment,
            "nearest_physical_strike_ms": attempt.nearest_physical_strike_ms,
            "nearest_physical_strike_delta_ms": attempt.nearest_physical_strike_delta_ms,
            "nearest_physical_strike_pitches": attempt.nearest_physical_strike_pitches,
        }
        for attempt in attempts
    ]
    return tuple(sorted((*note_on_items, *attempt_items), key=lambda item: int(item["relative_ms"])))


def _failure_detail(
    case: CaseSpec,
    failure: FailureCode,
    attempts: tuple[AttemptTrace, ...],
    frame_traces: tuple[FrameTrace, ...],
) -> FailureDetail | None:
    if failure == "EARLY_FALSE_ADVANCE":
        return _early_false_advance_detail(case, attempts, frame_traces)
    if _case_kind(case) == "pedal_sustain_tail_without_retrigger" and failure == "FALSE_ATTACK_OPEN":
        return _pedal_false_attempt_detail(case, attempts, frame_traces)
    return None


def _early_false_advance_detail(
    case: CaseSpec,
    attempts: tuple[AttemptTrace, ...],
    frame_traces: tuple[FrameTrace, ...],
) -> FailureDetail | None:
    second_start_ms = _second_target_relative_ms(case)
    if second_start_ms is None:
        return None
    attempt = next(
        (
            candidate
            for candidate in attempts
            if candidate.expected_group_id == "entry-2"
            and candidate.advanced
            and candidate.resolved_at_ms is not None
            and candidate.resolved_at_ms < second_start_ms - 50
        ),
        None,
    )
    if attempt is None:
        return None
    frame = _frame_at_or_before(frame_traces, attempt.started_at_ms)
    expected = _expected_pitches_for_group(case, attempt.expected_group_id)
    has_physical_strike = attempt.physical_strike_alignment == "TRUE_PHYSICAL_STRIKE_ATTEMPT"
    physical_pitches = attempt.nearest_physical_strike_pitches if has_physical_strike else ()
    observed = attempt.observed_pitches
    if not has_physical_strike:
        root_cause = "FALSE_ONSET_TO_FALSE_ADVANCE"
        note = "No MIDI note-on was within tolerance of the attempt that advanced early."
    elif set(physical_pitches).intersection(expected):
        root_cause = "BENCHMARK_TARGET_ASSIGNMENT_ISSUE"
        note = (
            "The early advancing attempt is aligned to a real physical strike that includes "
            "the expected pitch, before the benchmark's declared second target timestamp."
        )
    elif set(observed).intersection(expected):
        root_cause = "WRONG_STRIKE_PITCH_FALSE_POSITIVE"
        note = (
            "A real wrong physical strike opened a legitimate attempt, but the observer "
            "reported the expected pitch and the evaluator advanced."
        )
    else:
        root_cause = "BENCHMARK_TIMING_OR_ALIGNMENT_ISSUE"
        note = "The attempt advanced early, but the pitch evidence does not fit a simple false-positive explanation."
    return _detail_from_attempt(
        root_cause=root_cause,
        attempt=attempt,
        frame=frame,
        expected_pitches=expected,
        onset_false=(not has_physical_strike and bool(frame.onset_signal) if frame else None),
        attempt_behavior=(
            "attempt opened from upstream start candidate and advanced before declared second target"
        ),
        note=note,
    )


def _pedal_false_attempt_detail(
    case: CaseSpec,
    attempts: tuple[AttemptTrace, ...],
    frame_traces: tuple[FrameTrace, ...],
) -> FailureDetail | None:
    attempt = next(
        (
            candidate
            for candidate in attempts
            if candidate.physical_strike_alignment == "FALSE_ATTEMPT_WITHOUT_STRIKE"
        ),
        None,
    )
    if attempt is None:
        return None
    frame = _frame_at_or_before(frame_traces, attempt.started_at_ms)
    expected = _expected_pitches_for_group(case, attempt.expected_group_id)
    if frame is not None and frame.attempt_open and not frame.start_candidate_signal:
        root_cause = "ACCUMULATOR_OPENED_WITHOUT_START_CANDIDATE"
        note = "The attempt opened even though the diagnostic frame says start_candidate_signal=false."
    elif frame is not None and frame.start_candidate_signal and frame.onset_signal:
        root_cause = "FALSE_ONSET_TRIGGER"
        note = "No MIDI note-on was near the attempt; upstream onset_signal/start_candidate_signal opened it."
    elif frame is not None and frame.start_candidate_signal:
        root_cause = "NON_ONSET_START_CANDIDATE_TRIGGER"
        note = "No MIDI note-on was near the attempt; start_candidate_signal opened it without onset_signal on that frame."
    else:
        root_cause = "UNATTRIBUTED_FALSE_ATTEMPT"
        note = "No MIDI note-on was near the attempt, but no clear start-candidate trigger was captured."
    return _detail_from_attempt(
        root_cause=root_cause,
        attempt=attempt,
        frame=frame,
        expected_pitches=expected,
        onset_false=(bool(frame.onset_signal) if frame else None),
        attempt_behavior="attempt opened without any physical MIDI note-on within tolerance",
        note=note,
    )


def _detail_from_attempt(
    *,
    root_cause: str,
    attempt: AttemptTrace,
    frame: FrameTrace | None,
    expected_pitches: tuple[str, ...],
    onset_false: bool | None,
    attempt_behavior: str,
    note: str,
) -> FailureDetail:
    return FailureDetail(
        root_cause=root_cause,
        anchor_ms=attempt.started_at_ms,
        physical_strike_near_failure=(
            attempt.physical_strike_alignment == "TRUE_PHYSICAL_STRIKE_ATTEMPT"
        ),
        nearest_physical_strike_ms=attempt.nearest_physical_strike_ms,
        nearest_physical_strike_delta_ms=attempt.nearest_physical_strike_delta_ms,
        physical_pitches=(
            attempt.nearest_physical_strike_pitches
            if attempt.physical_strike_alignment == "TRUE_PHYSICAL_STRIKE_ATTEMPT"
            else ()
        ),
        expected_pitches=expected_pitches,
        observed_pitches=attempt.observed_pitches,
        matched_pitches=attempt.matched_pitches,
        evaluation=attempt.evaluation_result,
        advance=attempt.advanced,
        onset_false=onset_false,
        attempt_behavior=attempt_behavior,
        spectral_flux=None if frame is None else frame.spectral_flux,
        calibrated_flux_gate=None if frame is None else frame.calibrated_flux_gate,
        start_candidate_signal=None if frame is None else frame.start_candidate_signal,
        onset_signal=None if frame is None else frame.onset_signal,
        note=note,
    )


def _failure_frame_trace(
    failure_detail: FailureDetail | None,
    frame_traces: tuple[FrameTrace, ...],
) -> tuple[FrameTrace, ...]:
    if failure_detail is None or failure_detail.anchor_ms is None:
        return ()
    start_ms = failure_detail.anchor_ms - 500
    end_ms = failure_detail.anchor_ms + 500
    return tuple(
        frame
        for frame in frame_traces
        if start_ms <= frame.relative_ms <= end_ms
    )


def _frame_at_or_before(
    frame_traces: tuple[FrameTrace, ...],
    timestamp_ms: int,
) -> FrameTrace | None:
    prior = [frame for frame in frame_traces if frame.relative_ms <= timestamp_ms]
    if prior:
        return prior[-1]
    return frame_traces[0] if frame_traces else None


def _expected_pitches_for_group(case: CaseSpec, group_id: str) -> tuple[str, ...]:
    prefix = "entry-"
    if not group_id.startswith(prefix):
        return ()
    try:
        index = int(group_id[len(prefix) :]) - 1
    except ValueError:
        return ()
    if 0 <= index < len(case.expected_groups):
        return case.expected_groups[index]
    return ()


def _case_kind(case: CaseSpec) -> str:
    metadata = case.source_metadata or {}
    if "case_kind" in metadata:
        return str(metadata["case_kind"])
    if case.case_id == "wrong_octave_c5_for_c4":
        return "wrong_octave"
    if case.case_id == "wrong_semitone_for_c4":
        return "wrong_semitone"
    if case.case_id == "missing_chord_note_c4_for_c4_c5":
        return "missing_chord_tone"
    if case.case_id == "sustain_tail_without_new_strike":
        return "sustain_tail_without_retrigger"
    if case.case_id == "same_note_retrigger_c4":
        return "same_note_retrigger"
    return case.case_id


def _audio_for_case(case: CaseSpec) -> np.ndarray:
    silence = np.zeros(int(case.padding_before_seconds * SAMPLE_RATE), dtype=np.float32)
    if case.case_id == "same_note_retrigger_c4":
        first = _read_fixture(case.source_paths[0])
        second = _read_fixture(case.source_paths[1])
        gap = np.zeros(int(case.inter_strike_silence_seconds * SAMPLE_RATE), dtype=np.float32)
        return np.concatenate((silence, first, gap, second))
    if not case.source_paths:
        return silence
    return np.concatenate((silence, _read_fixture(case.source_paths[0])))


def _read_fixture(relative_path: str) -> np.ndarray:
    candidate = Path(relative_path)
    path = candidate if candidate.exists() else FIXTURE_ROOT / relative_path
    with wave.open(str(path), "rb") as recording:
        sample_rate = recording.getframerate()
        channels = recording.getnchannels()
        width = recording.getsampwidth()
        raw = recording.readframes(recording.getnframes())
    if sample_rate != SAMPLE_RATE or width != 2:
        raise ValueError(f"Expected 16 kHz 16-bit PCM fixture: {path}")
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio


def _split_frames(audio: np.ndarray, frame_length: int) -> tuple[np.ndarray, ...]:
    usable = (audio.size // frame_length) * frame_length
    audio = audio[:usable]
    return tuple(
        audio[start : start + frame_length].astype(np.float32)
        for start in range(0, usable, frame_length)
    )


def _expected_group(pitches: tuple[str, ...], index: int) -> ExpectedPracticeGroup:
    notes = tuple(
        ExpectedPracticeNote(
            expected_note_id=f"event-{index}:n{note_index}",
            event_id=f"event-{index}",
            pitch=pitch,
            render_note_id=f"n{index}-{note_index}",
            measure_numbers=(str(index),),
        )
        for note_index, pitch in enumerate(pitches, start=1)
    )
    strike_targets = tuple(
        ExpectedPracticeStrikeTarget(
            strike_id=f"entry-{index}:strike:{pitch}",
            pitch=pitch,
            expected_notes=tuple(note for note in notes if note.pitch == pitch),
            event_ids=(f"event-{index}",),
            render_note_ids=tuple(note.render_note_id for note in notes if note.pitch == pitch),
            measure_numbers=(str(index),),
        )
        for pitch in dict.fromkeys(pitches)
    )
    return ExpectedPracticeGroup(
        group_id=f"entry-{index}",
        onset_beat=float(index),
        event_ids=(f"event-{index}",),
        expected_notes=notes,
        strike_targets=strike_targets,
        render_note_ids=tuple(note.render_note_id for note in notes),
        pitches=tuple(dict.fromkeys(pitches)),
        measure_numbers=(str(index),),
        staff_ids=("1",),
        voice_ids=("1",),
    )


def _markdown_table(results: tuple[CaseResult, ...]) -> str:
    lines = [
        "| Case | Attack 正确？ | Attempt 正确？ | Pitch 正确？ | Evaluation | Advance | Primary failure |",
        "| ---- | ---------- | ----------- | --------- | ---------- | ------- | --------------- |",
    ]
    for result in results:
        lines.append(
            "| "
            + " | ".join(
                (
                    result.case_id,
                    _bool_cell(result.attack_correct),
                    _bool_cell(result.attempt_correct),
                    _bool_cell(result.pitch_correct),
                    result.evaluation,
                    str(result.actual_advances),
                    result.primary_failure,
                )
            )
            + " |"
        )
    return "\n".join(lines)


def _summary(results: tuple[CaseResult, ...]) -> dict[str, object]:
    by_failure = Counter(result.primary_failure for result in results)
    by_kind_failure = Counter(
        (
            str((result.source_metadata or {}).get("case_kind", result.case_id)),
            result.primary_failure,
        )
        for result in results
    )
    physical_alignment = Counter()
    retrigger = Counter()
    for result in results:
        physical_alignment.update(result.physical_attempt_summary or {})
        audit = result.retrigger_audit
        if audit is not None:
            if int(audit["early_false_advance_count"]) > 0:
                retrigger["false_advance_before_next_expected_physical_strike"] += 1
            elif bool(audit["retrigger_matched_after_actual_retrigger"]):
                retrigger["correct_retrigger"] += 1
            else:
                retrigger["retrigger_missed_after_actual_retrigger"] += 1
            if int(audit["early_attempt_count"]) > 0 and audit["intervening_physical_strikes"]:
                retrigger["early_attempt_with_intervening_physical_strike"] += 1
            elif int(audit["early_attempt_count"]) > 0:
                retrigger["early_attempt_without_physical_strike"] += 1
    return {
        "case_count": len(results),
        "by_primary_failure": dict(sorted(by_failure.items())),
        "by_case_kind_and_failure": {
            f"{kind}:{failure}": count
            for (kind, failure), count in sorted(by_kind_failure.items())
        },
        "by_attempt_physical_alignment": dict(sorted(physical_alignment.items())),
        "same_note_retrigger": dict(sorted(retrigger.items())),
    }


def _bool_cell(value: bool | None) -> str:
    if value is None:
        return "n/a"
    return "yes" if value else "no"


if __name__ == "__main__":
    main()
