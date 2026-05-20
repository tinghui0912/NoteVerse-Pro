from __future__ import annotations

import builtins
from unittest.mock import patch

import pytest

from app.core.config import Settings
from app.processing.engines.matchmaker_live import (
    BrowserAudioStreamAdapter,
    MatchmakerLiveEngine,
    build_alignment_engine,
)
from app.processing.realtime.audio_buffer import AudioChunkBuffer
from app.processing.realtime.session_runtime import PracticeSessionRuntimeRegistry
from app.processing.realtime.session_runtime import PracticeSessionRuntime

ORIGINAL_IMPORT = builtins.__import__


class DummyAlignmentEngine:
    def ingest_audio(self, chunk: bytes):
        _ = chunk
        return None

    @property
    def is_ready_for_performance(self) -> bool:
        return False

    def close(self) -> None:
        pass


class DummyReadyAlignmentEngine:
    def __init__(self) -> None:
        self._is_ready_for_performance = False

    def ingest_audio(self, chunk: bytes):
        _ = chunk
        self._is_ready_for_performance = True
        return None

    @property
    def is_ready_for_performance(self) -> bool:
        return self._is_ready_for_performance

    def close(self) -> None:
        pass


class DummyProcessor:
    def __call__(self, audio):
        return audio


class DummyQueue:
    def __init__(self) -> None:
        self.items = []

    def put(self, item) -> None:
        self.items.append(item)


class DummyProcessorFactory:
    def __init__(self, name: str) -> None:
        self.name = name

    def __call__(self, sample_rate: int, hop_length: int):
        return {
            "name": self.name,
            "sample_rate": sample_rate,
            "hop_length": hop_length,
        }


class DummyArztFollower:
    DEFAULT_DISTANCE_FUNC = "default-distance"

    def __init__(
        self,
        reference_features,
        queue,
        distance_func,
        frame_rate: int,
        ref_frame_to_beat=None,
        state_space=None,
    ) -> None:
        self.reference_features = reference_features
        self.queue = queue
        self.distance_func = distance_func
        self.frame_rate = frame_rate
        self.ref_frame_to_beat = ref_frame_to_beat
        self.state_space = state_space


def import_without_matchmaker(name, *args, **kwargs):
    if name == "partitura" or name == "matchmaker" or name.startswith("matchmaker."):
        raise ImportError(f"No module named '{name}'")
    return ORIGINAL_IMPORT(name, *args, **kwargs)


def test_practice_matchmaker_feature_type_defaults_to_lse() -> None:
    assert Settings().PRACTICE_MATCHMAKER_FEATURE_TYPE == "lse"


def test_practice_matchmaker_feature_type_accepts_logspectral_alias() -> None:
    settings = Settings(PRACTICE_MATCHMAKER_FEATURE_TYPE="logspectral")

    assert settings.PRACTICE_MATCHMAKER_FEATURE_TYPE == "lse"


def test_matchmaker_live_engine_builds_lse_processor() -> None:
    processor = MatchmakerLiveEngine._build_audio_processor(
        feature_type="lse",
        sample_rate=16000,
        hop_length=533,
        chroma_processor=DummyProcessorFactory("chroma"),
        lse_processor=DummyProcessorFactory("lse"),
    )

    assert processor == {"name": "lse", "sample_rate": 16000, "hop_length": 533}


def test_matchmaker_live_engine_builds_arzt_follower() -> None:
    feature_queue = DummyQueue()
    follower = MatchmakerLiveEngine._build_score_follower(
        method="arzt",
        reference_features=["features"],
        feature_queue=feature_queue,
        frame_rate=30,
        arzt_follower=DummyArztFollower,
        ref_frame_to_beat=[0.0, 0.5, 1.0],
        state_space=[0.0, 0.5, 1.0],
    )

    assert follower.reference_features == ["features"]
    assert follower.queue is feature_queue
    assert follower.distance_func == "default-distance"
    assert follower.frame_rate == 30
    assert follower.ref_frame_to_beat == [0.0, 0.5, 1.0]
    assert follower.state_space == [0.0, 0.5, 1.0]


def test_browser_audio_stream_adapter_rejects_quiet_frames() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.01,
        start_peak_gate=0.04,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    accepted = adapter.ingest(np.full(16, 0.001, dtype=np.float32))

    assert accepted is False
    assert adapter.rejected_frames == 1
    assert feature_queue.items == []


def test_browser_audio_stream_adapter_accepts_voiced_frames() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.01,
        start_peak_gate=0.04,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    first = adapter.ingest(np.full(16, 0.05, dtype=np.float32))
    second = adapter.ingest(np.full(16, 0.05, dtype=np.float32))

    assert first is True
    assert second is True
    assert adapter.ready_to_start is True
    assert adapter.accepted_frames == 2
    assert len(feature_queue.items) == 1


def test_browser_audio_stream_adapter_streams_quiet_frames_after_start() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.01,
        start_peak_gate=0.04,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    assert adapter.ingest(np.full(16, 0.05, dtype=np.float32)) is True
    assert adapter.ingest(np.full(16, 0.05, dtype=np.float32)) is True
    assert adapter.ready_to_start is True

    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is True
    assert adapter.accepted_frames == 3
    assert adapter.rejected_frames == 0
    assert len(feature_queue.items) == 2


def test_browser_audio_stream_adapter_requires_sustained_signal() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.2,
        start_peak_gate=0.2,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    assert adapter.ingest(np.full(16, 0.05, dtype=np.float32)) is True
    assert adapter.ready_to_start is False
    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is False
    assert adapter.ready_to_start is False


def test_browser_audio_stream_adapter_rejects_peak_only_spikes() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.2,
        start_peak_gate=0.2,
        min_active_frames=1,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    frame = np.zeros(128, dtype=np.float32)
    frame[0] = 0.08

    accepted = adapter.ingest(frame)

    assert accepted is False
    assert adapter.ready_to_start is False
    assert feature_queue.items == []


def test_browser_audio_stream_adapter_ignores_startup_transients() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.2,
        start_peak_gate=0.2,
        min_active_frames=2,
        warmup_frames=3,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.08, dtype=np.float32)) is False

    assert adapter.ready_to_start is False
    assert adapter.accepted_frames == 0
    assert feature_queue.items == []

    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is False
    assert adapter.ingest(np.full(16, 0.35, dtype=np.float32)) is True
    assert adapter.ready_to_start is False
    assert adapter.ingest(np.full(16, 0.35, dtype=np.float32)) is True
    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_calibrates_against_noise_floor() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.01,
        start_peak_gate=0.04,
        min_active_frames=2,
        warmup_frames=3,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.009, dtype=np.float32)) is False

    assert adapter.ingest(np.full(16, 0.02, dtype=np.float32)) is False
    assert adapter.ready_to_start is False
    assert feature_queue.items == []

    assert adapter.ingest(np.full(16, 0.13, dtype=np.float32)) is True
    assert adapter.ingest(np.full(16, 0.13, dtype=np.float32)) is True
    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_does_not_calibrate_from_warmup_performance() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.2,
        start_peak_gate=0.2,
        min_active_frames=2,
        warmup_frames=3,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.08, dtype=np.float32)) is False

    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is False
    assert adapter.ingest(np.full(16, 0.25, dtype=np.float32)) is True
    assert adapter.ingest(np.full(16, 0.25, dtype=np.float32)) is True
    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_requires_strong_start_signal() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.08,
        start_peak_gate=0.18,
        min_active_frames=1,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(5):
        assert adapter.ingest(np.full(16, 0.05, dtype=np.float32)) is True

    assert adapter.ready_to_start is False
    assert feature_queue.items == []

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is True

    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_uses_adaptive_start_gate() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.08,
        start_peak_gate=0.18,
        min_active_frames=1,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter._calibrated_rms_gate = 0.035
    adapter._calibrated_peak_gate = 0.078
    frame = np.full(16, 0.05, dtype=np.float32)
    frame[0] = 0.12

    assert adapter.ingest(frame) is True

    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_ignores_near_gate_warmup_transients() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.08,
        start_peak_gate=0.18,
        min_active_frames=1,
        warmup_frames=3,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.014, dtype=np.float32)) is False

    assert adapter._calibrated_rms_gate == 0.015
    assert adapter._calibrated_peak_gate == 0.06


def test_browser_audio_stream_adapter_requires_quiet_arming_after_warmup() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.08,
        start_peak_gate=0.18,
        min_active_frames=1,
        warmup_frames=3,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False

    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is False
    assert adapter.ready_to_start is False

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is True
    assert adapter.ready_to_start is True


def test_practice_runtime_registry_registers_and_releases_sessions() -> None:
    registry = PracticeSessionRuntimeRegistry()

    with patch(
        "app.processing.realtime.session_runtime.build_alignment_engine",
        return_value=DummyAlignmentEngine(),
    ):
        runtime = registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
        )

    assert runtime.session_id == "session-1"
    assert registry.get("session-1") is runtime

    released = registry.release("session-1")

    assert released is runtime
    assert registry.get("session-1") is None


def test_practice_runtime_emits_ready_notification_once() -> None:
    runtime = PracticeSessionRuntime(
        session_id="session-1",
        task_id="task-1",
        state="CREATED",
        score_file_path="score.xml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        audio_buffer=AudioChunkBuffer(),
        engine=DummyReadyAlignmentEngine(),
    )

    assert runtime.consume_ready_notification() is False

    runtime.process_audio_chunk(b"\x00\x00")

    assert runtime.consume_ready_notification() is True
    assert runtime.consume_ready_notification() is False


def test_alignment_engine_factory_rejects_fake_engine() -> None:
    with pytest.raises(ValueError):
        build_alignment_engine(
            engine_name="fake",
            score_file_path="score.xml",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
        )


def test_alignment_engine_factory_requires_matchmaker_dependency() -> None:
    with patch("builtins.__import__", side_effect=import_without_matchmaker):
        with pytest.raises(RuntimeError, match="pymatchmaker"):
            build_alignment_engine(
                engine_name="matchmaker",
                score_file_path="score.xml",
                sample_rate=16000,
                channels=1,
                frame_format="pcm_s16le",
            )


def test_matchmaker_live_engine_raises_when_dependency_is_unavailable() -> None:
    with patch("builtins.__import__", side_effect=import_without_matchmaker):
        with pytest.raises(RuntimeError, match="pymatchmaker"):
            MatchmakerLiveEngine(
                score_file_path="score.xml",
                sample_rate=16000,
                channels=1,
                frame_format="pcm_s16le",
            )


def test_matchmaker_live_engine_rejects_unsupported_audio_shape() -> None:
    with pytest.raises(RuntimeError, match="mono"):
        MatchmakerLiveEngine(
            score_file_path="score.xml",
            sample_rate=16000,
            channels=2,
            frame_format="pcm_s16le",
        )


def test_matchmaker_live_engine_rejects_unsupported_frame_format() -> None:
    with pytest.raises(RuntimeError, match="pcm_s16le"):
        MatchmakerLiveEngine(
            score_file_path="score.xml",
            sample_rate=16000,
            channels=1,
            frame_format="float32",
        )
