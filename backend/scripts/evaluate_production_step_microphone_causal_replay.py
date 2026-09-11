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
FixtureStatus = Literal["real_fixture", "derived_from_real_fixture", "missing_required_fixture"]


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
    missing_fixture_request: str | None = None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/work/datasets/production_step_microphone_causal_replay_report.json"),
    )
    args = parser.parse_args()

    cases = _case_specs()
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

    for frame_index, frame in enumerate(frames, start=1):
        timestamp_ms = int((frame_index * frame_length / SAMPLE_RATE) * 1000)
        stream.ingest(frame)
        if stream.started and first_start_gate_ms is None:
            first_start_gate_ms = timestamp_ms
        current_group = follow_policy.current_expected_group
        if current_group is None:
            continue

        observation = accumulator.observe_frame(
            frame,
            candidate_signal=_wait_for_note_candidate_signal(stream),
            start_candidate_signal=_wait_for_note_start_candidate_signal(stream),
            onset_beat=current_group.onset_beat,
            expected_group_id=current_group.group_id,
            timestamp_ms=timestamp_ms,
        )
        if accumulator.open and not previous_open:
            attempt_open_count += 1
        previous_open = accumulator.open
        if observation is None:
            continue

        evaluation = follow_policy.evaluate_evidence(EvaluatorEvidence.from_audio(observation))
        decision = follow_policy.decide_evaluation(
            evidence=EvaluatorEvidence.from_audio(observation),
            evaluation=evaluation,
        )
        advanced = decision["action"] == "advance"
        if advanced:
            actual_advances += 1
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

    return _classify_case(
        case=case,
        stream=stream,
        first_start_gate_ms=first_start_gate_ms,
        attempt_open_count=attempt_open_count,
        actual_advances=actual_advances,
        attempts=tuple(attempts),
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


def _classify_case(
    *,
    case: CaseSpec,
    stream: BrowserAudioStreamAdapter,
    first_start_gate_ms: int | None,
    attempt_open_count: int,
    actual_advances: int,
    attempts: tuple[AttemptTrace, ...],
) -> CaseResult:
    advance = actual_advances > 0
    latest_evaluation = attempts[-1].evaluation_result if attempts else "NO_ATTEMPT"
    expected_any_attack = case.case_id not in {"noise_desk_knock_for_c4"}
    attack_correct = (attempt_open_count > 0) == expected_any_attack
    if case.case_id == "sustain_tail_without_new_strike":
        attempt_correct = attempt_open_count == 1
    elif case.case_id == "same_note_retrigger_c4":
        second_start_ms = _second_source_start_ms(case)
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
        missing_fixture_request=case.missing_fixture_request,
    )


def _pitch_correct(case: CaseSpec, attempts: tuple[AttemptTrace, ...]) -> bool | None:
    if not attempts:
        return None
    if case.case_id == "wrong_octave_c5_for_c4":
        return all("C4" not in attempt.observed_pitches for attempt in attempts)
    if case.case_id == "noise_desk_knock_for_c4":
        return all(not attempt.observed_pitches for attempt in attempts)
    if case.case_id == "missing_chord_note_c4_for_c4_c5":
        return all(attempt.evaluation_result != "MATCH" for attempt in attempts)
    if case.case_id == "sustain_tail_without_new_strike":
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
    if case.fixture_status == "missing_required_fixture":
        return "MISSING_REQUIRED_FIXTURE"
    if case.case_id == "noise_desk_knock_for_c4":
        if actual_advances > 0:
            return "NOISE_FALSE_COMPLETION"
        if first_start_gate_ms is not None or attempt_open_count > 0:
            return "FALSE_ATTACK_OPEN"
        return "NONE"
    if case.case_id == "wrong_octave_c5_for_c4":
        if actual_advances > 0:
            return "OCTAVE_CONFUSION"
        return "ATTACK_MISSED" if not attempts else "NONE"
    if case.case_id == "wrong_semitone_for_c4":
        return "SEMITONE_CONFUSION" if actual_advances > 0 else "NONE"
    if case.case_id == "missing_chord_note_c4_for_c4_c5":
        if actual_advances > 0:
            return "MISSING_NOTE_FALSE_COMPLETION"
        return "NONE"
    if case.case_id == "sustain_tail_without_new_strike":
        if actual_advances > 1:
            return "PEDAL_TAIL_FALSE_COMPLETION"
        if attempt_open_count > 1:
            return "FALSE_ATTACK_OPEN"
        return "NONE"
    if case.case_id == "same_note_retrigger_c4":
        second_start_ms = _second_source_start_ms(case)
        if (
            second_start_ms is not None
            and len(attempts) >= 2
            and attempts[1].started_at_ms < second_start_ms - 50
        ):
            return "PEDAL_TAIL_FALSE_COMPLETION" if attempts[1].advanced else "ATTEMPT_BOUNDARY_ERROR"
        if actual_advances < case.expected_advances:
            return "RETRIGGER_MISSED" if attempt_open_count < case.expected_advances else "PITCH_FALSE_NEGATIVE"
        return "NONE"
    if actual_advances < case.expected_advances:
        return "ATTACK_MISSED" if not attempts else "PITCH_FALSE_NEGATIVE"
    if actual_advances > case.expected_advances:
        return "PITCH_FALSE_POSITIVE"
    return "NONE"


def _boundary_note(case: CaseSpec, attempts: tuple[AttemptTrace, ...]) -> str:
    if case.case_id != "same_note_retrigger_c4" or len(attempts) < 2:
        return ""
    second_start_ms = _second_source_start_ms(case)
    if second_start_ms is None:
        return ""
    if attempts[1].started_at_ms < second_start_ms - 50:
        return (
            "Second expected target was resolved before the second source strike "
            f"began at approximately {second_start_ms} ms."
        )
    return ""


def _second_source_start_ms(case: CaseSpec) -> int | None:
    if case.case_id != "same_note_retrigger_c4" or len(case.source_paths) < 2:
        return None
    first_duration_ms = int((_read_fixture(case.source_paths[0]).size / SAMPLE_RATE) * 1000)
    return int(case.padding_before_seconds * 1000) + first_duration_ms + int(
        case.inter_strike_silence_seconds * 1000
    )


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
    path = FIXTURE_ROOT / relative_path
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


def _bool_cell(value: bool | None) -> str:
    if value is None:
        return "n/a"
    return "yes" if value else "no"


if __name__ == "__main__":
    main()
