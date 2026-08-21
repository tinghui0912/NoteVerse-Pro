from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import wave

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
        "warmup_frames": 0,
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
