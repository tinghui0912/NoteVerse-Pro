from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from types import SimpleNamespace
import wave

from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ExpectedPracticeNote,
    ExpectedPracticeStrikeTarget,
)
from app.processing.engines.practice_alignment.browser_audio_stream import BrowserAudioStreamAdapter


class DummyProcessor:
    def __call__(self, audio):
        return audio


class DummyQueue:
    def __init__(self) -> None:
        self.items = []

    def put(self, item) -> None:
        self.items.append(item)


@dataclass
class ReplayFrameDiagnostics:
    index: int
    stream_state: str
    frame_class: str
    gate_reason: str
    runtime_reason: str
    queue_decision: str
    no_input_streak: int
    audio_active: bool
    rms: float
    peak: float


@dataclass
class ReplayResult:
    started_frame: int | None
    states: list[str]
    frames: list[ReplayFrameDiagnostics]
    accepted_frames: int
    queued_frames: int


def voiced_frame(np, amplitude: float, length: int = 128):
    samples = np.arange(length, dtype=np.float32)
    return (amplitude * np.sin(2 * np.pi * 8 * samples / length)).astype(np.float32)


def sine_audio(np, frequency_hz: float, *, seconds: float, sample_rate: int = 16000):
    samples = np.arange(int(sample_rate * seconds), dtype=np.float32) / sample_rate
    return (0.25 * np.sin(2 * np.pi * frequency_hz * samples)).astype(np.float32)


def expected_practice_group(*pitches: str) -> ExpectedPracticeGroup:
    expected_notes = tuple(
        ExpectedPracticeNote(
            expected_note_id=f"event-1:n{index}",
            event_id="event-1",
            pitch=pitch,
            render_note_id=f"n{index}",
            measure_numbers=("1",),
        )
        for index, pitch in enumerate(pitches, start=1)
    )
    strike_targets = tuple(
        ExpectedPracticeStrikeTarget(
            strike_id=f"entry-1:strike:{pitch}",
            pitch=pitch,
            expected_notes=tuple(note for note in expected_notes if note.pitch == pitch),
            event_ids=("event-1",),
            render_note_ids=tuple(
                note.render_note_id for note in expected_notes if note.pitch == pitch
            ),
            measure_numbers=("1",),
        )
        for pitch in dict.fromkeys(pitches)
    )
    return ExpectedPracticeGroup(
        group_id="entry-1",
        onset_beat=4.0,
        event_ids=("event-1",),
        expected_notes=expected_notes,
        strike_targets=strike_targets,
        render_note_ids=tuple(note.render_note_id for note in expected_notes),
        pitches=tuple(dict.fromkeys(pitches)),
        measure_numbers=("1",),
        staff_ids=("1",),
        voice_ids=("1",),
    )


def impulse_noise_frame(np, amplitude: float = 0.5, length: int = 128):
    frame = np.zeros(length, dtype=np.float32)
    frame[0] = amplitude
    return frame


def split_audio_into_frames(np, audio, frame_length: int):
    return [
        audio[index : index + frame_length].astype(np.float32)
        for index in range(0, len(audio), frame_length)
        if len(audio[index : index + frame_length]) == frame_length
    ]


def read_pcm_wav_audio(np, path: Path):
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        frames = wav_file.readframes(wav_file.getnframes())

    if sample_width != 2:
        raise ValueError(f"Replay wav must be 16-bit PCM: {path}")

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio


def read_pcm_wav_frames(np, path: Path, frame_length: int):
    audio = read_pcm_wav_audio(np, path)
    return split_audio_into_frames(np, audio, frame_length)


def mix_wav_frames(np, manifest_path: Path, spec: dict, frame_length: int):
    sample_rate = int(spec.get("sample_rate", 16000))
    duration_samples = int(float(spec["duration_seconds"]) * sample_rate)
    mix = np.zeros(duration_samples, dtype=np.float32)

    for source in spec["sources"]:
        audio = read_pcm_wav_audio(np, (manifest_path.parent / source["path"]).resolve())
        gain = 10 ** (float(source.get("gain_db", 0.0)) / 20.0)
        offset = int(float(source.get("offset_seconds", 0.0)) * sample_rate)
        if offset >= duration_samples:
            continue
        available_samples = duration_samples - offset
        if bool(source.get("loop", False)) and audio.size:
            repeats = int(np.ceil(available_samples / audio.size))
            audio = np.tile(audio, repeats)
        length = min(audio.size, available_samples)
        mix[offset : offset + length] += audio[:length] * gain

    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    if peak > 0.98:
        mix = mix * (0.98 / peak)
    return split_audio_into_frames(np, mix, frame_length)


def manifest_frames(np, manifest_path: Path, scenario: dict):
    frame_length = int(scenario.get("frame_length") or scenario["_manifest_frame_length"])
    frames = []
    for spec in scenario["frames"]:
        count = int(spec.get("count", 1))
        frame_type = spec["type"]
        amplitude = float(spec.get("amplitude", 0.0))
        if frame_type == "sine":
            frame = voiced_frame(np, amplitude, frame_length)
            frames.extend([frame.copy() for _ in range(count)])
        elif frame_type == "impulse":
            frame = impulse_noise_frame(np, amplitude, frame_length)
            frames.extend([frame.copy() for _ in range(count)])
        elif frame_type == "constant":
            frame = np.full(frame_length, amplitude, dtype=np.float32)
            frames.extend([frame.copy() for _ in range(count)])
        elif frame_type == "silence":
            frame = np.zeros(frame_length, dtype=np.float32)
            frames.extend([frame.copy() for _ in range(count)])
        elif frame_type == "wav":
            wav_path = (manifest_path.parent / spec["path"]).resolve()
            frames.extend(read_pcm_wav_frames(np, wav_path, frame_length))
        elif frame_type == "mix_wav":
            frames.extend(mix_wav_frames(np, manifest_path, spec, frame_length))
        else:
            raise ValueError(f"Unsupported replay frame type: {frame_type}")
    return frames


def load_replay_manifest() -> list[dict]:
    manifest_path = Path(__file__).parent / "fixtures" / "practice_audio" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scenarios = manifest["scenarios"]
    for scenario in scenarios:
        scenario["_manifest_path"] = manifest_path
        scenario["_manifest_frame_length"] = int(manifest["frame_length"])
    return scenarios


def load_profile_replay_manifest() -> tuple[dict, Path]:
    manifest_path = Path(__file__).parent / "fixtures" / "practice_audio" / "profile_manifest.json"
    return json.loads(manifest_path.read_text(encoding="utf-8")), manifest_path


def load_initial_alignment_replay_manifest() -> tuple[dict, Path]:
    manifest_path = (
        Path(__file__).parent / "fixtures" / "practice_audio" / "initial_alignment_manifest.json"
    )
    return json.loads(manifest_path.read_text(encoding="utf-8")), manifest_path


def test_replay_diagnostics_summarize_terminal_region_decisions() -> None:
    from scripts.evaluate_practice_replay import (
        attempt_events,
        benchmark_summary,
        decision_counts,
        slim_alignment_update,
    )

    updates = [
        {
            "beat_position": 24.73,
            "confidence": 0.0,
            "alignment_confidence": 0.0,
            "audio_confidence": 1.0,
            "continuity_confidence": 0.95,
            "validation_confidence": 0.0,
            "input_policy_confidence": 1.0,
            "feature_confidence": 0.0,
            "match_state": "matched",
            "alignment_state": "feature_mismatch",
            "continuity_state": "stable",
            "beat_delta": 0.06,
            "decision": {
                "action": "hold",
                "reason": "low_alignment_confidence",
                "experience_state": "heard_but_uncertain",
                "display_anchor": {"beat": 24.0},
                "attempt_state": "resolved",
                "attempt_sequence": 7,
                "attempt_started_at_ms": 1200,
                "attempt_resolved_at_ms": 1320,
                "evaluator_version": "expected-event-v1",
                "evaluation_result": "UNCERTAIN",
                "matched_pitches": [],
                "missing_pitches": ["C4"],
                "extra_pitches": [],
            },
            "gate_reason": "runtime_activity",
            "queue_decision": "queued",
            "tonal_signal": True,
            "onset_signal": False,
        }
    ]

    assert decision_counts(updates) == {"hold:low_alignment_confidence": 1}
    assert slim_alignment_update(updates[0]) == {
        "beat_position": 24.73,
        "confidence": 0.0,
        "alignment_confidence": 0.0,
        "audio_confidence": 1.0,
        "continuity_confidence": 0.95,
        "validation_confidence": 0.0,
        "input_policy_confidence": 1.0,
        "feature_confidence": 0.0,
        "match_state": "matched",
        "alignment_state": "feature_mismatch",
        "continuity_state": "stable",
        "beat_delta": 0.06,
        "scope_completed": False,
        "decision_action": "hold",
        "decision_reason": "low_alignment_confidence",
        "decision_anchor_beat": 24.0,
        "attempt_state": "resolved",
        "attempt_sequence": 7,
        "attempt_started_at_ms": 1200,
        "attempt_resolved_at_ms": 1320,
        "evaluator_version": "expected-event-v1",
        "evaluation_result": "UNCERTAIN",
        "matched_pitches": [],
        "missing_pitches": ["C4"],
        "extra_pitches": [],
    }
    assert attempt_events(updates, [16000], 16000) == [
        {
            "update_index": 0,
            "seconds": 1.0,
            "beat_position": 24.73,
            "anchor_beat": 24.0,
            "attempt_state": "resolved",
            "attempt_sequence": 7,
            "attempt_started_at_ms": 1200,
            "attempt_resolved_at_ms": 1320,
            "decision_action": "hold",
            "decision_reason": "low_alignment_confidence",
            "experience_state": "heard_but_uncertain",
            "evaluator_version": "expected-event-v1",
            "evaluation_result": "UNCERTAIN",
            "matched_pitches": [],
            "missing_pitches": ["C4"],
            "extra_pitches": [],
            "scope_completed": False,
            "confidence": 0.0,
            "validation_confidence": 0.0,
            "input_policy_confidence": 1.0,
            "gate_reason": "runtime_activity",
            "queue_decision": "queued",
            "tonal_signal": True,
            "onset_signal": False,
            "alignment_state": "feature_mismatch",
        }
    ]
    assert benchmark_summary(attempt_events(updates, [16000], 16000)) == {
        "benchmark_scope": "baseline_runtime_replay",
        "causal": True,
        "uses_future_context": False,
        "evidence_horizon_ms": 0,
        "ground_truth_source": "score_expectation",
        "progression_authority": True,
        "metric_priority": [
            "false_match_count",
            "score_expected_strike_coverage",
            "expected_strike_recall",
            "expected_strike_precision",
            "chord_complete_detection_rate",
            "median_time_to_match_ms",
            "p95_time_to_match_ms",
            "per_pitch_extra_rate",
            "uncertain_rate",
        ],
        "attempt_count": 1,
        "expected_strike_count": 1,
        "matched_strike_count": 0,
        "extra_pitch_count": 0,
        "false_match_count": 0,
        "false_advance_guard_count": 0,
        "annotated_false_advance_count": 0,
        "score_expected_strike_coverage": 0.0,
        "expected_strike_recall": None,
        "expected_strike_precision": None,
        "chord_attempt_count": 0,
        "chord_complete_detection_rate": None,
        "per_pitch_extra_rate": 0.0,
        "median_time_to_match_ms": None,
        "p95_time_to_match_ms": None,
        "uncertain_rate": 1.0,
        "diagnostic_reason_counts": {"low_alignment_confidence": 1},
    }


def test_replay_attempt_events_separate_evaluated_target_from_display_target() -> None:
    from scripts.evaluate_practice_replay import attempt_events

    updates = [
        {
            "beat_position": 4.0,
            "confidence": 0.95,
            "validation_confidence": 0.95,
            "input_policy_confidence": 0.95,
            "alignment_state": "matched",
            "decision": {
                "action": "advance",
                "reason": "stable_match",
                "experience_state": "following",
                "display_anchor": {"beat": 5.0, "group_id": "entry-2"},
                "attempt_state": "resolved",
                "attempt_sequence": 1,
                "attempt_started_at_ms": 100,
                "attempt_resolved_at_ms": 160,
                "evaluation_result": "MATCH",
                "matched_pitches": ["C4"],
                "missing_pitches": [],
                "extra_pitches": [],
            },
        }
    ]
    target_contexts = {
        "entry-1": {
            "index": 0,
            "group_id": "entry-1",
            "onset_beat": 4.0,
            "measure_number": "2",
            "beat_in_measure": 1.0,
            "expected_pitches": ["C4"],
            "render_note_ids": ["n1"],
        },
        "entry-2": {
            "index": 1,
            "group_id": "entry-2",
            "onset_beat": 5.0,
            "measure_number": "2",
            "beat_in_measure": 2.0,
            "expected_pitches": ["D4"],
            "render_note_ids": ["n2"],
        },
    }

    event = attempt_events(updates, [3200], 16000, target_contexts)[0]

    assert event["display_target"] == target_contexts["entry-2"]
    assert event["evaluated_target"] == target_contexts["entry-1"]


def test_replay_benchmark_summary_prioritizes_false_advance_and_chord_recall() -> None:
    from scripts.evaluate_practice_replay import benchmark_summary

    attempts = [
        {
            "attempt_state": "resolved",
            "attempt_started_at_ms": 100,
            "attempt_resolved_at_ms": 220,
            "decision_action": "advance",
            "decision_reason": "stable_match",
            "evaluation_result": "MATCH",
            "matched_pitches": ["C4", "E4"],
            "missing_pitches": [],
            "extra_pitches": [],
        },
        {
            "attempt_state": "resolved",
            "attempt_started_at_ms": 300,
            "attempt_resolved_at_ms": 420,
            "decision_action": "wait",
            "decision_reason": "partial_match",
            "evaluation_result": "PARTIAL",
            "matched_pitches": ["G4"],
            "missing_pitches": ["B4"],
            "extra_pitches": [],
        },
        {
            "attempt_state": "resolved",
            "attempt_started_at_ms": 500,
            "attempt_resolved_at_ms": 580,
            "decision_action": "advance",
            "decision_reason": "stable_match",
            "evaluation_result": "MISMATCH",
            "matched_pitches": [],
            "missing_pitches": ["D4"],
            "extra_pitches": ["F4"],
        },
    ]

    summary = benchmark_summary(
        attempts,
        {"resume": {"accepted_outside_region": 2}},
    )

    assert summary == {
        "benchmark_scope": "baseline_runtime_replay",
        "causal": True,
        "uses_future_context": False,
        "evidence_horizon_ms": 0,
        "ground_truth_source": "score_expectation",
        "progression_authority": True,
        "metric_priority": [
            "false_match_count",
            "score_expected_strike_coverage",
            "expected_strike_recall",
            "expected_strike_precision",
            "chord_complete_detection_rate",
            "median_time_to_match_ms",
            "p95_time_to_match_ms",
            "per_pitch_extra_rate",
            "uncertain_rate",
        ],
        "attempt_count": 3,
        "expected_strike_count": 5,
        "matched_strike_count": 3,
        "extra_pitch_count": 1,
        "false_match_count": 1,
        "false_advance_guard_count": 1,
        "annotated_false_advance_count": 2,
        "score_expected_strike_coverage": 0.6,
        "expected_strike_recall": None,
        "expected_strike_precision": None,
        "chord_attempt_count": 2,
        "chord_complete_detection_rate": 0.5,
        "per_pitch_extra_rate": 0.2,
        "median_time_to_match_ms": 120.0,
        "p95_time_to_match_ms": 120.0,
        "uncertain_rate": 0.0,
        "diagnostic_reason_counts": {
            "accepted_match": 1,
            "low_expected_activation": 1,
            "false_advance_guard": 1,
        },
    }


def test_observer_window_benchmark_scope_does_not_claim_progression_authority() -> None:
    from scripts.evaluate_practice_replay import benchmark_summary

    summary = benchmark_summary(
        [
            {
                "attempt_state": "resolved",
                "decision_action": "advance",
                "decision_reason": "stable_match",
                "evaluation_result": "MISMATCH",
                "matched_pitches": [],
                "missing_pitches": ["C4"],
                "extra_pitches": ["D4"],
            }
        ],
        benchmark_scope="observer_window_replay",
    )

    assert summary["benchmark_scope"] == "observer_window_replay"
    assert summary["progression_authority"] is False
    assert summary["false_match_count"] == 1
    assert summary["false_advance_guard_count"] is None


def test_offline_score_aligned_oracle_does_not_emit_progression_metrics() -> None:
    from scripts.evaluate_practice_replay import benchmark_summary

    summary = benchmark_summary(
        [
            {
                "attempt_state": "resolved",
                "decision_action": "project",
                "decision_reason": "offline_score_aligned_projection",
                "attempt_started_at_ms": 0,
                "attempt_resolved_at_ms": 120,
                "evaluation_result": "MATCH",
                "matched_pitches": ["C4"],
                "missing_pitches": [],
                "extra_pitches": [],
            }
        ],
        benchmark_scope="offline_score_aligned_oracle",
    )

    assert summary["benchmark_scope"] == "offline_score_aligned_oracle"
    assert summary["causal"] is False
    assert summary["uses_future_context"] is True
    assert summary["ground_truth_source"] == "score_expectation"
    assert summary["progression_authority"] is False
    assert summary["score_expected_strike_coverage"] == 1.0
    assert summary["expected_strike_recall"] is None
    assert summary["expected_strike_precision"] is None
    assert summary["false_match_count"] is None
    assert summary["false_advance_guard_count"] is None
    assert summary["median_time_to_match_ms"] is None
    assert summary["p95_time_to_match_ms"] is None


def test_physical_ground_truth_enables_recall_and_precision_metrics() -> None:
    from scripts.evaluate_practice_replay import benchmark_summary

    summary = benchmark_summary(
        [
            {
                "attempt_state": "resolved",
                "decision_action": "advance",
                "decision_reason": "stable_match",
                "evaluation_result": "MATCH",
                "matched_pitches": ["C4"],
                "missing_pitches": ["E4"],
                "extra_pitches": ["G4"],
            }
        ],
        ground_truth_source="paired_midi",
    )

    assert summary["ground_truth_source"] == "paired_midi"
    assert summary["score_expected_strike_coverage"] == 0.5
    assert summary["expected_strike_recall"] == 0.5
    assert summary["expected_strike_precision"] == 0.5


def test_target_conditioned_shadow_runtime_benchmark_runs_independent_attempts(monkeypatch) -> None:
    import numpy as np

    import scripts.evaluate_practice_replay as replay_script
    from scripts.evaluate_practice_replay import target_conditioned_shadow_runtime_benchmark

    group = expected_practice_group("C4")
    monkeypatch.setattr(
        replay_script,
        "practice_score_timeline_from_musicxml",
        lambda _score_path: SimpleNamespace(expected_practice_groups=(group,)),
    )
    audio = np.concatenate(
        (
            np.zeros(1600, dtype=np.float32),
            sine_audio(np, 261.625565, seconds=0.5),
        )
    )

    benchmark = target_conditioned_shadow_runtime_benchmark(
        audio=audio,
        sample_rate=16000,
        score_path=Path("dummy.musicxml"),
        practice_scope={"start_expected_group_id": None, "end_expected_group_id": None},
    )

    assert benchmark["benchmark_scope"] == "causal_shadow_runtime_replay"
    assert benchmark["progression_authority"] is True
    assert benchmark["status"] == "experimental"
    assert benchmark["attempt_events"][0]["decision_action"] == "advance"
    assert benchmark["attempt_events"][0]["evaluation_result"] == "MATCH"
    assert benchmark["benchmark_summary"]["benchmark_scope"] == "causal_shadow_runtime_replay"
    assert benchmark["benchmark_summary"]["progression_authority"] is True


def test_target_conditioned_candidate_benchmark_replays_same_attempt_window(monkeypatch) -> None:
    import numpy as np

    import scripts.evaluate_practice_replay as replay_script

    group = expected_practice_group("C4")
    monkeypatch.setattr(
        replay_script,
        "practice_score_timeline_from_musicxml",
        lambda _score_path: SimpleNamespace(expected_practice_groups=(group,)),
    )
    baseline_attempts = [
        {
            "update_index": 0,
            "seconds": 0.5,
            "beat_position": 4.0,
            "anchor_beat": 4.0,
            "attempt_state": "resolved",
            "attempt_sequence": 1,
            "attempt_started_at_ms": 0,
            "attempt_resolved_at_ms": 500,
            "experience_state": "following",
            "evaluated_target": {"group_id": "entry-1"},
            "display_target": {"group_id": "entry-1"},
        }
    ]

    attempts = replay_script.target_conditioned_candidate_attempts(
        baseline_attempts=baseline_attempts,
        audio=sine_audio(np, 261.625565, seconds=0.5),
        sample_rate=16000,
        score_path=Path("dummy.musicxml"),
    )

    assert attempts[0]["evaluator_version"] == "target-conditioned-dsp-v1"
    assert attempts[0]["evaluation_result"] == "MATCH"
    assert attempts[0]["matched_pitches"] == ["C4"]
    assert attempts[0]["pitch_activations"][0]["pitch"] == "C4"
    assert attempts[0]["pitch_activations"][0]["confidence"] == 1.0
    assert attempts[0]["pitch_activations"][0]["matched"] is True


def test_replay_annotation_metrics_describe_external_recovery_facts() -> None:
    from scripts.evaluate_practice_replay import annotation_metrics

    metrics = annotation_metrics(
        [
            {
                "id": "resume_at_measure_8",
                "kind": "valid_resume",
                "start_seconds": 8.0,
                "end_seconds": 9.0,
                "expected_anchor_beat_min": 32.0,
                "expected_anchor_beat_max": 33.0,
                "post_recovery_stability_seconds": 1.0,
            }
        ],
        accepted_events=[
            {
                "seconds": 8.2,
                "anchor_beat": 36.0,
                "action": "advance",
                "reason": "stable_match",
                "confidence": 0.9,
            },
            {
                "seconds": 8.6,
                "anchor_beat": 32.5,
                "action": "advance",
                "reason": "stable_match",
                "confidence": 0.92,
            },
        ],
        frame_states=[
            {"seconds": 9.1, "state": "following"},
            {"seconds": 9.2, "state": "lost"},
            {"seconds": 9.3, "state": "lost"},
            {"seconds": 9.4, "state": "following"},
        ],
    )

    resume = metrics["resume_at_measure_8"]
    assert resume["accepted_events"] == 2
    assert resume["accepted_in_region"] == 1
    assert resume["accepted_outside_region"] == 1
    assert resume["first_accepted_in_region_seconds"] == 8.6
    assert resume["recovery_latency_seconds"] == 0.6
    assert resume["post_recovery_lost_episodes"] == 1


def test_replay_wav_reader_resamples_fixture_audio(tmp_path: Path) -> None:
    import numpy as np

    from scripts.evaluate_practice_replay import read_pcm_wav

    wav_path = tmp_path / "source_48k.wav"
    source_rate = 48000
    target_rate = 16000
    duration_seconds = 0.1
    samples = np.arange(int(source_rate * duration_seconds), dtype=np.float32)
    waveform = 0.25 * np.sin(2 * np.pi * 440 * samples / source_rate)
    stereo = np.column_stack((waveform, waveform))

    with wave.open(str(wav_path), "wb") as wav_file:
        wav_file.setnchannels(2)
        wav_file.setsampwidth(2)
        wav_file.setframerate(source_rate)
        wav_file.writeframes((stereo * 32767).astype("<i2").tobytes())

    audio = read_pcm_wav(wav_path, target_rate)

    assert audio.dtype == np.float32
    assert audio.shape == (int(target_rate * duration_seconds),)
    assert float(np.max(np.abs(audio))) > 0.2


def make_adapter(np, **overrides):
    queue = DummyQueue()
    defaults = {
        "processor": DummyProcessor(),
        "feature_queue": queue,
        "np": np,
        "hop_length": 4,
        "rms_gate": 0.01,
        "peak_gate": 0.04,
        "start_rms_gate": 0.01,
        "start_peak_gate": 0.04,
        "min_active_frames": 2,
        "calibration_sample_count": 0,
        "rms_noise_multiplier": 4.0,
        "peak_noise_multiplier": 2.5,
        "diagnostics_enabled": False,
        "no_input_frames": 3,
        "onset_flux_gate": 0.1,
        "onset_hold_frames": 6,
    }
    defaults.update(overrides)
    return BrowserAudioStreamAdapter(**defaults), queue


def replay(adapter: BrowserAudioStreamAdapter, frames) -> ReplayResult:
    states: list[str] = []
    diagnostics: list[ReplayFrameDiagnostics] = []
    started_frame: int | None = None
    for index, frame in enumerate(frames, start=1):
        adapter.ingest(frame)
        states.append(adapter.stream_state)
        diagnostics.append(
            ReplayFrameDiagnostics(
                index=index,
                stream_state=adapter.stream_state,
                frame_class=adapter.last_frame_class,
                gate_reason=adapter.last_gate_reason,
                runtime_reason=adapter.last_runtime_activity_reason,
                queue_decision=adapter.last_queue_decision,
                no_input_streak=adapter.no_input_streak,
                audio_active=adapter.last_audio_active,
                rms=adapter.last_rms,
                peak=adapter.last_peak,
            )
        )
        if adapter.ready_to_start and started_frame is None:
            started_frame = index

    return ReplayResult(
        started_frame=started_frame,
        states=states,
        frames=diagnostics,
        accepted_frames=adapter.accepted_frames,
        queued_frames=len(adapter.queue.items),
    )


def assert_manifest_expectations(result: ReplayResult, adapter, scenario: dict) -> None:
    expect = scenario["expect"]
    if "started_frame" in expect:
        assert result.started_frame == expect["started_frame"]
    if "started_frame_min" in expect:
        assert result.started_frame is not None
        assert result.started_frame >= expect["started_frame_min"]
    if "started_frame_max" in expect:
        assert result.started_frame is not None
        assert result.started_frame <= expect["started_frame_max"]
    if "queued_frames" in expect:
        assert result.queued_frames == expect["queued_frames"]
    if "queued_frames_min" in expect:
        assert result.queued_frames >= expect["queued_frames_min"]
    if "queued_frames_max" in expect:
        assert result.queued_frames <= expect["queued_frames_max"]
    if "ready_to_start" in expect:
        assert adapter.ready_to_start is expect["ready_to_start"]
    if "min_following_frames" in expect:
        assert result.states.count("following") >= expect["min_following_frames"]
    if "max_lost_frames" in expect:
        assert result.states.count("lost") <= expect["max_lost_frames"]
    if "max_no_input_streak" in expect:
        assert (
            max((frame.no_input_streak for frame in result.frames), default=0)
            <= expect["max_no_input_streak"]
        )
    for state in expect.get("forbidden_states", []):
        assert state not in result.states
    gate_reasons = [frame.gate_reason for frame in result.frames]
    runtime_reasons = [frame.runtime_reason for frame in result.frames]
    queue_decisions = [frame.queue_decision for frame in result.frames]
    for reason in expect.get("forbidden_gate_reasons", []):
        assert reason not in gate_reasons
    for reason in expect.get("forbidden_runtime_reasons", []):
        assert reason not in runtime_reasons
    for decision in expect.get("forbidden_queue_decisions", []):
        assert decision not in queue_decisions
    for index, state in expect.get("state_at", {}).items():
        assert result.states[int(index) - 1] == state


def test_manifest_replay_scenarios() -> None:
    import numpy as np

    for scenario in load_replay_manifest():
        adapter, _queue = make_adapter(np, **scenario.get("adapter", {}))
        frames = manifest_frames(np, scenario["_manifest_path"], scenario)

        result = replay(adapter, frames)

        assert_manifest_expectations(result, adapter, scenario)


def test_profile_replay_manifest_builds_finite_audio_frames() -> None:
    import numpy as np

    for manifest, manifest_path in [
        load_profile_replay_manifest(),
        load_initial_alignment_replay_manifest(),
    ]:
        frame_length = int(manifest["sample_rate"] / 30)

        for scenario in manifest["scenarios"]:
            frames = manifest_frames(
                np,
                manifest_path,
                {
                    **scenario,
                    "_manifest_frame_length": frame_length,
                },
            )
            assert frames, scenario["id"]
            assert all(frame.size == frame_length for frame in frames), scenario["id"]
            assert all(np.isfinite(frame).all() for frame in frames), scenario["id"]


def test_profile_replay_manifest_includes_complete_once_again_recording() -> None:
    manifest, _manifest_path = load_profile_replay_manifest()
    scenarios = {scenario["id"]: scenario for scenario in manifest["scenarios"]}

    scenario = scenarios["once_again_full_recording_start_and_progress"]

    assert scenario["quality_status"] == "known_gap"
    assert scenario["frames"] == [
        {
            "type": "wav",
            "path": "local_recordings/Once Again.wav",
            "duration_seconds": 20,
        }
    ]
    assert scenario["expect"]["starts"] is True
    assert scenario["expect"]["min_alignment_advance"] == 8.0


def test_initial_alignment_manifest_declares_phase_and_chunking_matrix() -> None:
    manifest, _manifest_path = load_initial_alignment_replay_manifest()
    scenarios = {scenario["id"]: scenario for scenario in manifest["scenarios"]}

    assert {
        "once_again_phase_offset_0",
        "once_again_phase_offset_1",
        "once_again_phase_offset_quarter_hop",
        "once_again_phase_offset_half_hop",
        "once_again_phase_offset_hop_minus_1",
        "once_again_armed_delay_12s",
        "wrong_c4_then_once_again_restart",
        "once_again_chunk_256_samples",
        "once_again_chunk_640_samples",
    } <= scenarios.keys()
    assert scenarios["once_again_phase_offset_0"]["leading_sample_offset"] == 0
    assert scenarios["once_again_phase_offset_1"]["leading_sample_offset"] == 1
    assert scenarios["once_again_phase_offset_quarter_hop"]["leading_sample_offset"] == 133
    assert scenarios["once_again_phase_offset_half_hop"]["leading_sample_offset"] == 266
    assert scenarios["once_again_phase_offset_hop_minus_1"]["leading_sample_offset"] == 532
    assert scenarios["once_again_armed_delay_12s"]["armed_delay_seconds"] == 12
    assert scenarios["once_again_chunk_256_samples"]["chunk_size_samples"] == 256
    assert scenarios["once_again_chunk_640_samples"]["chunk_size_samples"] == 640


def test_initial_alignment_scenario_audio_applies_offsets_and_armed_delay() -> None:
    import numpy as np

    from scripts.evaluate_practice_replay import scenario_audio

    manifest, manifest_path = load_initial_alignment_replay_manifest()
    sample_rate = int(manifest["sample_rate"])
    baseline = next(
        scenario for scenario in manifest["scenarios"] if scenario["id"] == "once_again_phase_offset_0"
    )
    shifted = next(
        scenario for scenario in manifest["scenarios"] if scenario["id"] == "once_again_phase_offset_1"
    )
    delayed = next(
        scenario for scenario in manifest["scenarios"] if scenario["id"] == "once_again_armed_delay_12s"
    )

    baseline_audio = scenario_audio(manifest_path.parent, baseline, sample_rate)
    shifted_audio = scenario_audio(manifest_path.parent, shifted, sample_rate)
    delayed_audio = scenario_audio(manifest_path.parent, delayed, sample_rate)

    assert shifted_audio.size == baseline_audio.size + 1
    assert shifted_audio[0] == 0
    assert np.array_equal(shifted_audio[1:], baseline_audio)
    assert delayed_audio.size == baseline_audio.size + 12 * sample_rate
    assert np.all(delayed_audio[: 12 * sample_rate] == 0)
    assert np.array_equal(delayed_audio[12 * sample_rate :], baseline_audio)


def test_replay_scenario_audio_supports_explicit_silence_segments() -> None:
    import numpy as np

    from scripts.evaluate_practice_replay import scenario_audio

    manifest, manifest_path = load_initial_alignment_replay_manifest()
    sample_rate = int(manifest["sample_rate"])
    scenario = {
        "frames": [
            { "type": "silence", "duration_seconds": 0.25 },
        ],
    }

    audio = scenario_audio(manifest_path.parent, scenario, sample_rate)

    assert audio.size == int(sample_rate * 0.25)
    assert np.all(audio == 0)


def test_replay_evaluator_checks_follow_quality_expectations() -> None:
    from scripts.evaluate_practice_replay import evaluate_result

    result = {
        "error": None,
        "started": True,
        "start_seconds": 0.5,
        "lost_frames": 3,
        "lost_episodes": 2,
        "lost_frame_ratio": 0.25,
        "following_frame_ratio": 0.7,
        "reliable_updates": 4,
        "reliable_update_ratio": 0.2,
        "time_to_first_reliable_alignment": 0.4,
        "first_alignment_beat": 3.0,
        "alignment_advance": 4.0,
        "accepted_anchor_beat_min": 2.5,
        "accepted_anchor_beat_max": 12.5,
        "scope_completed": False,
        "completion_reason": None,
        "accepted_completion_beat": 11.8,
        "accepted_completion_alignment_beat": 11.8,
        "reference_slice": {
            "terminal_region_start_beat": 11.93,
        },
        "annotated_events": {
            "resume_at_measure_8": {
                "accepted_in_region": 0,
                "accepted_outside_region": 2,
                "recovery_latency_seconds": None,
                "post_recovery_lost_episodes": 1,
            }
        },
        "pause_checked": False,
        "pause_emitted_updates": 0,
        "resume_emitted_updates": 0,
    }
    expect = {
        "starts": True,
        "max_lost_frames": 0,
        "max_lost_episodes": 0,
        "max_lost_frame_ratio": 0.1,
        "min_following_frame_ratio": 0.95,
        "min_reliable_updates": 5,
        "min_reliable_update_ratio": 0.3,
        "max_time_to_first_reliable_alignment": 0.12,
        "min_alignment_advance": 8.0,
        "accepted_anchor_beat_min": 3.0,
        "accepted_anchor_beat_max": 12.0,
        "scope_completed": True,
        "completion_reason": "FINAL_EXPECTED_GROUP_MATCHED",
        "accepted_completion_beat_min": 11.93,
        "accepted_completion_beat_max": 12.0,
        "accepted_completion_must_reach_terminal_region": True,
        "annotation_checks": [
            {
                "id": "resume_at_measure_8",
                "min_accepted_in_region": 1,
                "max_accepted_outside_region": 0,
                "max_recovery_latency_seconds": 0.5,
                "max_post_recovery_lost_episodes": 0,
            }
        ],
    }

    failures = evaluate_result(result, expect)

    assert "lost_frames=3 above maximum" in failures
    assert "lost_episodes=2 above maximum" in failures
    assert "lost_frame_ratio=0.25 above maximum" in failures
    assert "following_frame_ratio=0.7 below minimum" in failures
    assert "reliable_updates=4 below minimum" in failures
    assert "reliable_update_ratio=0.2 below minimum" in failures
    assert "time_to_first_reliable_alignment=0.4 above maximum" in failures
    assert "alignment_advance=4.0 below minimum" in failures
    assert "accepted_anchor_beat_min=2.5 below minimum" in failures
    assert "accepted_anchor_beat_max=12.5 above maximum" in failures
    assert (
        "accepted_completion_alignment_beat=11.8 before terminal_region_start_beat=11.93"
        in failures
    )
    assert "resume_at_measure_8.accepted_in_region=0 below minimum" in failures
    assert "resume_at_measure_8.accepted_outside_region=2 above maximum" in failures
    assert "resume_at_measure_8.missing recovery latency" in failures
    assert "resume_at_measure_8.post_recovery_lost_episodes=1 above maximum" in failures
    assert "scope_completed=False expected=True" in failures


def test_replay_report_pass_status_ignores_known_gap_failures() -> None:
    from scripts.evaluate_practice_replay import known_gap_failures, required_replay_results_pass

    required_pass = {"id": "required_pass", "quality_status": "required", "failures": []}
    required_fail = {
        "id": "required_fail",
        "quality_status": "required",
        "failures": ["required failure"],
    }
    known_gap_fail = {
        "id": "known_gap_fail",
        "quality_status": "known_gap",
        "failures": ["documented gap"],
    }

    assert required_replay_results_pass([required_pass, known_gap_fail]) is True
    assert required_replay_results_pass([required_pass, required_fail]) is False
    assert known_gap_failures([required_pass, known_gap_fail]) == {
        "known_gap_fail": ["documented gap"]
    }


def test_replay_weak_sustain_keeps_following_before_decay_window_expires() -> None:
    import numpy as np

    adapter, queue = make_adapter(np)
    frames = [
        voiced_frame(np, 0.08),
        voiced_frame(np, 0.08),
        voiced_frame(np, 0.018),
        voiced_frame(np, 0.012),
        voiced_frame(np, 0.006),
        np.full(128, 0.001, dtype=np.float32),
        np.full(128, 0.001, dtype=np.float32),
    ]

    result = replay(adapter, frames)

    assert result.started_frame == 2
    assert "lost" not in result.states
    assert result.states[4] == "following"
    assert result.states[-1] == "following"
    assert result.queued_frames == len(queue.items)
    assert result.queued_frames == 6


def test_replay_non_musical_impulses_do_not_false_start() -> None:
    import numpy as np

    adapter, queue = make_adapter(
        np,
        start_rms_gate=0.08,
        start_peak_gate=0.18,
        min_active_frames=2,
    )
    frames = [
        impulse_noise_frame(np, 0.7),
        np.zeros(128, dtype=np.float32),
        impulse_noise_frame(np, 0.6),
        np.zeros(128, dtype=np.float32),
        impulse_noise_frame(np, 0.8),
    ]

    result = replay(adapter, frames)

    assert result.started_frame is None
    assert adapter.ready_to_start is False
    assert result.queued_frames == 0
    assert queue.items == []


def test_replay_session_window_eventually_decays_to_lost_after_silence() -> None:
    import numpy as np

    adapter, _queue = make_adapter(
        np,
        no_input_frames=2,
        onset_hold_frames=2,
    )
    frames = [
        voiced_frame(np, 0.08),
        voiced_frame(np, 0.08),
        np.full(128, 0.001, dtype=np.float32),
        np.full(128, 0.001, dtype=np.float32),
        np.full(128, 0.001, dtype=np.float32),
        np.full(128, 0.001, dtype=np.float32),
        np.full(128, 0.001, dtype=np.float32),
        np.full(128, 0.001, dtype=np.float32),
        np.full(128, 0.001, dtype=np.float32),
    ]

    result = replay(adapter, frames)

    assert result.started_frame == 2
    assert result.states[2] == "following"
    assert result.states[6] == "holding_decay"
    assert result.states[7] == "lost"
    assert result.states[-1] == "lost"


def test_replay_non_musical_taps_do_not_refresh_runtime_activity() -> None:
    import numpy as np

    adapter, queue = make_adapter(
        np,
        no_input_frames=3,
        onset_hold_frames=4,
    )
    frames = [
        voiced_frame(np, 0.08),
        voiced_frame(np, 0.08),
        impulse_noise_frame(np, 0.8),
        impulse_noise_frame(np, 0.7),
        impulse_noise_frame(np, 0.9),
        impulse_noise_frame(np, 0.8),
        impulse_noise_frame(np, 0.7),
    ]

    result = replay(adapter, frames)

    assert result.started_frame == 2
    assert result.states[2] == "following"
    assert result.states[-1] == "following"
    assert adapter.activity_state.last_music_activity_frame == 2
    assert result.queued_frames == len(queue.items)
