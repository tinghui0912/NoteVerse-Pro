from __future__ import annotations

import builtins
import queue
import threading
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.core.config import get_practice_runtime_settings

from app.processing.engines.practice_alignment.matchmaker_live import (
    BrowserAudioStreamAdapter,
    MatchmakerLiveEngine,
    build_alignment_engine,
)
from app.processing.realtime.audio_buffer import AudioChunkBuffer
from app.processing.realtime.message_codec import session_armed_message
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
        data, _frame_time = audio
        return data, {"frame_time": _frame_time}


class DummyQueue:
    def __init__(self) -> None:
        self.items = []

    def put(self, item) -> None:
        self.items.append(item)


def voiced_frame(np, amplitude: float, length: int = 128):
    samples = np.arange(length, dtype=np.float32)
    return (amplitude * np.sin(2 * np.pi * 8 * samples / length)).astype(np.float32)


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
    def __init__(
        self,
        reference_features,
        score_positions,
        queue,
        frame_rate: int,
        ref_frame_to_beat=None,
    ) -> None:
        self.reference_features = reference_features
        self.score_positions = score_positions
        self.queue = queue
        self.frame_rate = frame_rate
        self.ref_frame_to_beat = ref_frame_to_beat


def import_without_matchmaker(name, *args, **kwargs):
    if name == "partitura" or name == "matchmaker" or name.startswith("matchmaker."):
        raise ImportError(f"No module named '{name}'")
    return ORIGINAL_IMPORT(name, *args, **kwargs)


def test_matchmaker_live_engine_builds_chroma_processor() -> None:
    processor = MatchmakerLiveEngine._build_audio_processor(
        sample_rate=16000,
        hop_length=533,
        chroma_processor=DummyProcessorFactory("chroma"),
    )

    assert processor == {"name": "chroma", "sample_rate": 16000, "hop_length": 533}


def test_matchmaker_live_engine_builds_arzt_follower() -> None:
    feature_queue = DummyQueue()
    follower = MatchmakerLiveEngine._build_score_follower(
        reference_features=["features"],
        feature_queue=feature_queue,
        frame_rate=30,
        arzt_follower=DummyArztFollower,
        ref_frame_to_beat=[0.0, 0.5, 1.0],
        score_positions=[0.0, 1.0],
    )

    assert follower.reference_features == ["features"]
    assert follower.score_positions == [0.0, 1.0]
    assert follower.queue is feature_queue
    assert follower.frame_rate == 30
    assert follower.ref_frame_to_beat == [0.0, 0.5, 1.0]
    assert follower.queue_timeout is None


def test_matchmaker_live_engine_uses_reference_feature_endpoint_for_completion() -> None:
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._reference_end_beat = 66.93
    engine._score_end_beat = 69.0

    assert engine._score_completed(66.67) is False
    assert engine._score_completed(66.68) is True


def test_matchmaker_live_engine_trims_reference_before_first_playable_note() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._score_start_beat = 3.0

    features, beats = engine._trim_reference_to_playable_start(
        np.array([[0.0], [1.0], [2.0], [3.0], [4.0]], dtype=np.float32),
        np.array([0.0, 1.0, 2.0, 3.0, 4.0], dtype=np.float32),
    )

    assert features.tolist() == [[3.0], [4.0]]
    assert beats.tolist() == [3.0, 4.0]


def test_matchmaker_live_engine_start_alignment_anchors_to_first_played_note() -> None:
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._score_start_beat = 3.0
    engine._last_beat_position = None
    engine._last_alignment_timestamp_ms = None
    engine._timestamp_ms = lambda: 1000
    engine._confidence_for_beat = lambda _beat: 0.95
    engine._continuity_confidence_for_beat = lambda _beat: 0.95
    engine._beat_velocity = lambda **_kwargs: None
    engine._continuity_state = lambda _delta: "initial"
    engine._score_completed = lambda _beat: False

    alignment = engine._start_alignment()

    assert alignment["beat_position"] == 3.0
    assert alignment["continuity_state"] == "initial"


def test_finished_follower_is_not_restarted() -> None:
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._closed = threading.Event()
    engine._follower_finished = True
    engine._worker = None

    engine._ensure_worker_started()

    assert engine._worker is None


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

    first = adapter.ingest(voiced_frame(np, 0.08))
    second = adapter.ingest(voiced_frame(np, 0.08))

    assert first is True
    assert second is True
    assert adapter.ready_to_start is True
    assert adapter.accepted_frames == 2
    assert len(feature_queue.items) == 1


def test_browser_audio_stream_adapter_queues_features_with_timestamp() -> None:
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

    adapter.ingest(voiced_frame(np, 0.08))
    adapter.ingest(voiced_frame(np, 0.08))

    queued_features, queued_time = feature_queue.items[0]
    assert not isinstance(queued_features, tuple)
    assert isinstance(queued_time, float)


def test_browser_audio_stream_adapter_starts_from_moderate_recorded_playback() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.035,
        start_peak_gate=0.065,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    assert adapter.ingest(voiced_frame(np, 0.085)) is True
    assert adapter.ready_to_start is False
    assert adapter.ingest(voiced_frame(np, 0.08)) is True

    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_rejects_broad_non_tonal_start_transient() -> None:
    import numpy as np

    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=DummyQueue(),
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.025,
        start_peak_gate=0.06,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter.last_tonal_signal = False
    adapter.last_spectral_flatness = 0.52
    adapter.last_peak_prominence = 22.0

    assert adapter._has_start_signal(0.032, 0.071) is False


def test_browser_audio_stream_adapter_rejects_low_prominence_start_transient() -> None:
    import numpy as np

    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=DummyQueue(),
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.025,
        start_peak_gate=0.06,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter.last_tonal_signal = True
    adapter.last_spectral_flatness = 0.29
    adapter.last_peak_prominence = 10.18

    assert adapter._has_start_signal(0.041, 0.153) is False


def test_browser_audio_stream_adapter_requires_strong_musical_start_after_warmup() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.025,
        start_peak_gate=0.06,
        min_active_frames=2,
        warmup_frames=3,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(128, 0.008, dtype=np.float32)) is False

    assert adapter._calibrated_rms_gate > 0.025
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.ingest(voiced_frame(np, 0.042)) is False
    assert adapter.ready_to_start is False
    assert adapter.ingest(voiced_frame(np, 0.042)) is False

    assert adapter.ingest(voiced_frame(np, 0.2)) is True
    assert adapter.ready_to_start is False
    assert adapter.ingest(voiced_frame(np, 0.2)) is True

    assert adapter.ready_to_start is True
    assert len(feature_queue.items) == 1


def test_browser_audio_stream_adapter_exposes_clear_state_transitions() -> None:
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
        warmup_frames=2,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
        no_input_frames=2,
        onset_hold_frames=2,
    )

    assert adapter.stream_state == "calibrating"
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.stream_state == "calibrating"
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.stream_state == "armed"
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.stream_state == "armed"

    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.stream_state == "armed"
    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.stream_state == "following"

    for _ in range(adapter.session_keepalive_frames):
        assert adapter.ingest(np.zeros(128, dtype=np.float32)) is True
        assert adapter.stream_state == "following"
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is True
    assert adapter.stream_state == "holding_decay"
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is True
    assert adapter.stream_state == "lost"


def test_browser_audio_stream_adapter_updates_runtime_noise_floor_slowly() -> None:
    import numpy as np

    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=DummyQueue(),
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

    initial_rms_gate = adapter._calibrated_rms_gate
    adapter._maybe_update_runtime_noise_floor(0.007, 0.02)

    assert adapter._calibrated_rms_gate > initial_rms_gate
    assert adapter._calibrated_peak_gate >= adapter.peak_gate


def test_browser_audio_stream_adapter_detects_spectral_flux_onset() -> None:
    import numpy as np

    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=DummyQueue(),
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
        onset_flux_gate=0.1,
    )

    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.last_onset_signal is False

    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.last_spectral_flux > adapter._calibrated_flux_gate
    assert adapter.last_onset_signal is True


def test_browser_audio_stream_adapter_does_not_retrigger_on_steady_tone() -> None:
    import numpy as np

    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=DummyQueue(),
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
        onset_flux_gate=0.1,
    )

    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.last_onset_signal is True
    assert adapter.ingest(voiced_frame(np, 0.08)) is True

    assert adapter.last_onset_signal is False


def test_browser_audio_stream_adapter_onset_hold_keeps_decay_active() -> None:
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
        no_input_frames=2,
        onset_flux_gate=0.1,
        onset_hold_frames=3,
    )

    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.stream_state == "following"
    assert adapter.performance_active is True

    assert adapter.ingest(voiced_frame(np, 0.004)) is True

    assert adapter.last_audio_active is True
    assert adapter.no_input_streak == 0


def test_browser_audio_stream_adapter_tracks_weak_tonal_tails_after_start() -> None:
    import numpy as np

    feature_queue = DummyQueue()
    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=feature_queue,
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.035,
        start_peak_gate=0.065,
        min_active_frames=2,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    assert adapter.ingest(voiced_frame(np, 0.085)) is True
    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.ready_to_start is True

    assert adapter.ingest(voiced_frame(np, 0.025)) is True

    assert adapter.last_audio_active is True
    assert len(feature_queue.items) == 2


def test_browser_audio_stream_adapter_streams_short_quiet_tail_after_start() -> None:
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

    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.ready_to_start is True

    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is True
    assert adapter.accepted_frames == 3
    assert adapter.rejected_frames == 0
    assert len(feature_queue.items) == 1


def test_browser_audio_stream_adapter_marks_no_input_after_sustained_quiet() -> None:
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
        no_input_frames=2,
        onset_hold_frames=2,
    )

    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.stream_state == "following"
    assert adapter.performance_active is True

    for _ in range(adapter.session_keepalive_frames):
        assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is True
        assert adapter.stream_state == "following"
        assert adapter.performance_active is True
    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is True
    assert adapter.stream_state == "holding_decay"
    assert adapter.performance_active is True
    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is True
    assert adapter.stream_state == "lost"
    assert adapter.performance_active is False
    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is True
    assert adapter.stream_state == "lost"
    assert adapter.performance_active is False
    assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is True
    assert adapter.stream_state == "lost"
    assert adapter.performance_active is False
    assert len(feature_queue.items) == 1

    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.stream_state == "following"
    assert adapter.performance_active is True
    assert len(feature_queue.items) == 2


def test_matchmaker_live_engine_keeps_alignment_updates_during_no_input() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._error = None
    engine.total_bytes = 0
    engine._updates = queue.Queue()
    engine._updates.put(
        {
            "beat_position": 4.0,
            "confidence": 0.95,
            "alignment_confidence": 0.95,
            "audio_confidence": 0.95,
            "continuity_confidence": 0.95,
            "visual_confidence": 0.95,
            "timestamp_ms": 1000,
            "score_completed": False,
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "match_state": "matched",
        }
    )
    engine._stream = SimpleNamespace(
        ingest=lambda _audio_frame: True,
        ready_to_start=True,
        no_input_streak=24,
        last_audio_active=False,
        last_rms=0.0,
        last_peak=0.0,
        stream_state="lost",
        activity_confidence_ceiling=0.0,
    )
    engine._ensure_worker_started = lambda: None
    engine._pcm_s16le_to_float32 = lambda _chunk: np.zeros(16, dtype=np.float32)

    alignment = engine.ingest_audio(b"\x00\x00")

    assert alignment is not None
    assert alignment["confidence"] == 0.0
    assert alignment["audio_active"] is False
    assert alignment["match_state"] == "lost"
    assert engine._updates.empty()


def test_matchmaker_live_engine_caps_confidence_when_audio_is_inactive() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._error = None
    engine.total_bytes = 0
    engine._updates = queue.Queue()
    engine._updates.put(
        {
            "beat_position": 4.0,
            "confidence": 0.95,
            "alignment_confidence": 0.95,
            "audio_confidence": 0.95,
            "continuity_confidence": 0.95,
            "visual_confidence": 0.95,
            "timestamp_ms": 1000,
            "score_completed": False,
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "match_state": "matched",
        }
    )
    engine._stream = SimpleNamespace(
        ingest=lambda _audio_frame: True,
        ready_to_start=True,
        no_input_streak=1,
        last_audio_active=False,
        last_rms=0.006,
        last_peak=0.02,
        stream_state="holding_decay",
        activity_confidence_ceiling=0.35,
    )
    engine._ensure_worker_started = lambda: None
    engine._pcm_s16le_to_float32 = lambda _chunk: np.zeros(16, dtype=np.float32)

    alignment = engine.ingest_audio(b"\x00\x00")

    assert alignment is not None
    assert alignment["confidence"] == 0.35
    assert alignment["audio_active"] is False
    assert alignment["match_state"] == "holding_decay"


def test_matchmaker_live_engine_caps_confidence_when_features_do_not_match_score() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._reference_features = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        ],
        dtype=np.float32,
    )
    engine._ref_frame_to_beat = np.array([0.0, 1.0], dtype=np.float32)
    engine._stream = SimpleNamespace(
        activity_confidence_ceiling=1.0,
        last_audio_active=True,
        last_rms=0.1,
        last_peak=0.3,
        stream_state="following",
        last_feature_vector=np.array([0.0, 1.0, 0.0], dtype=np.float32),
    )

    alignment = engine._with_current_audio_state(
        {
            "beat_position": 0.0,
            "confidence": 0.95,
            "alignment_confidence": 0.95,
            "audio_confidence": 1.0,
            "continuity_confidence": 0.95,
            "visual_confidence": 0.95,
            "timestamp_ms": 1000,
            "score_completed": False,
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "match_state": "matched",
        }
    )

    assert alignment["alignment_confidence"] == 0.0
    assert alignment["visual_confidence"] == 0.0
    assert alignment["confidence"] == 0.0
    assert alignment["alignment_state"] == "feature_mismatch"


def test_matchmaker_live_engine_keeps_confidence_when_features_match_score() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._reference_features = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        ],
        dtype=np.float32,
    )
    engine._ref_frame_to_beat = np.array([0.0, 1.0], dtype=np.float32)
    engine._stream = SimpleNamespace(
        activity_confidence_ceiling=1.0,
        last_audio_active=True,
        last_rms=0.1,
        last_peak=0.3,
        stream_state="following",
        last_feature_vector=np.array([1.0, 0.0, 0.0], dtype=np.float32),
    )

    alignment = engine._with_current_audio_state(
        {
            "beat_position": 0.0,
            "confidence": 0.95,
            "alignment_confidence": 0.95,
            "audio_confidence": 1.0,
            "continuity_confidence": 0.95,
            "visual_confidence": 0.95,
            "timestamp_ms": 1000,
            "score_completed": False,
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "match_state": "matched",
        }
    )

    assert alignment["alignment_confidence"] == 0.95
    assert alignment["visual_confidence"] == 0.95
    assert alignment["confidence"] == 0.95
    assert alignment["alignment_state"] == "matched"


def test_matchmaker_live_engine_explains_continuity_state() -> None:
    assert MatchmakerLiveEngine._continuity_state(None) == "initial"
    assert MatchmakerLiveEngine._continuity_state(-0.8) == "rollback"
    assert MatchmakerLiveEngine._continuity_state(-0.2) == "minor_rollback"
    assert MatchmakerLiveEngine._continuity_state(5.0) == "jump"
    assert MatchmakerLiveEngine._continuity_state(9.0) == "large_jump"
    assert MatchmakerLiveEngine._continuity_state(1.0) == "stable"


def test_matchmaker_live_engine_caps_weak_feature_match_below_visual_threshold() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._reference_features = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    engine._ref_frame_to_beat = np.array([0.0], dtype=np.float32)
    engine._stream = SimpleNamespace(
        activity_confidence_ceiling=1.0,
        last_audio_active=True,
        last_rms=0.1,
        last_peak=0.3,
        stream_state="following",
        last_feature_vector=np.array([1.0, 0.7, 0.0], dtype=np.float32),
    )

    alignment = engine._with_current_audio_state(
        {
            "beat_position": 0.0,
            "confidence": 0.95,
            "alignment_confidence": 0.95,
            "audio_confidence": 1.0,
            "continuity_confidence": 0.95,
            "visual_confidence": 0.95,
            "timestamp_ms": 1000,
            "score_completed": False,
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "match_state": "matched",
        }
    )

    assert alignment["alignment_state"] == "weak_feature_match"
    assert alignment["validation_confidence"] == 0.5
    assert alignment["visual_confidence"] == 0.5


def test_matchmaker_live_engine_validation_ceiling_penalizes_unstable_continuity() -> None:
    assert (
        MatchmakerLiveEngine._validation_confidence_ceiling(
            alignment_state="matched",
            continuity_state="stable",
        )
        == 1.0
    )
    assert (
        MatchmakerLiveEngine._validation_confidence_ceiling(
            alignment_state="matched",
            continuity_state="jump",
        )
        == 0.5
    )
    assert (
        MatchmakerLiveEngine._validation_confidence_ceiling(
            alignment_state="matched",
            continuity_state="large_jump",
        )
        == 0.3
    )
    assert (
        MatchmakerLiveEngine._validation_confidence_ceiling(
            alignment_state="feature_mismatch",
            continuity_state="stable",
        )
        == 0.0
    )


def test_matchmaker_live_engine_caps_confidence_with_input_policy_ceiling() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._reference_features = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    engine._ref_frame_to_beat = np.array([0.0], dtype=np.float32)
    engine._stream = SimpleNamespace(
        activity_confidence_ceiling=1.0,
        last_audio_active=True,
        last_rms=0.1,
        last_peak=0.3,
        stream_state="following",
        last_feature_vector=np.array([1.0, 0.0, 0.0], dtype=np.float32),
        last_input_weight=0.0,
        last_input_policy_confidence=0.2,
    )

    alignment = engine._with_current_audio_state(
        {
            "beat_position": 0.0,
            "confidence": 0.95,
            "alignment_confidence": 0.95,
            "audio_confidence": 1.0,
            "continuity_confidence": 0.95,
            "visual_confidence": 0.95,
            "timestamp_ms": 1000,
            "score_completed": False,
            "audio_active": True,
            "input_rms": 0.0,
            "input_peak": 0.0,
            "match_state": "matched",
        }
    )

    assert alignment["alignment_state"] == "matched"
    assert alignment["input_policy_confidence"] == 0.2
    assert alignment["visual_confidence"] == 0.2


def test_matchmaker_live_engine_calculates_beat_velocity() -> None:
    assert (
        MatchmakerLiveEngine._beat_velocity(
            beat_delta=1.5,
            timestamp_ms=2000,
            previous_timestamp_ms=1000,
        )
        == 1.5
    )
    assert (
        MatchmakerLiveEngine._beat_velocity(
            beat_delta=1.5,
            timestamp_ms=1000,
            previous_timestamp_ms=1000,
        )
        is None
    )


def test_matchmaker_live_engine_samples_alignment_diagnostics(monkeypatch) -> None:
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)

    monkeypatch.setattr(
        get_practice_runtime_settings(),
        "PRACTICE_AUDIO_DIAGNOSTICS",
        True,
    )
    monkeypatch.setattr(
        get_practice_runtime_settings(),
        "PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL",
        3,
    )

    assert engine._should_log_alignment_update() is True
    assert engine._should_log_alignment_update() is False
    assert engine._should_log_alignment_update() is True
    assert engine._should_log_alignment_update() is False

    assert engine._should_log_alignment_decision() is True
    assert engine._should_log_alignment_decision() is False
    assert engine._should_log_alignment_decision() is True


def test_matchmaker_live_engine_validates_start_against_first_score_feature() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._score_start_beat = 0.0
    engine._reference_features = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
        ],
        dtype=np.float32,
    )
    engine._ref_frame_to_beat = np.array([0.0, 1.0], dtype=np.float32)
    engine._stream = SimpleNamespace(last_feature_vector=None)

    assert engine._is_valid_start_feature(np.array([1.0, 0.0, 0.0], dtype=np.float32)) is True
    assert engine._is_valid_start_feature(np.array([0.0, 1.0, 0.0], dtype=np.float32)) is False


def test_matchmaker_live_engine_scores_broad_feature_matches_conservatively() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._reference_features = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    engine._ref_frame_to_beat = np.array([0.0], dtype=np.float32)
    engine._stream = SimpleNamespace(last_feature_vector=None)

    broad_feature = np.array([0.75, 0.45, 0.35], dtype=np.float32)

    assert engine._feature_confidence_for_beat(0.0, current_feature=broad_feature) < 0.55


def test_matchmaker_live_engine_rejects_non_finite_start_features() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._reference_features = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)
    engine._ref_frame_to_beat = np.array([0.0], dtype=np.float32)
    engine._stream = SimpleNamespace(last_feature_vector=None)

    nan_feature = np.array([np.nan, 0.0, 0.0], dtype=np.float32)

    assert engine._feature_confidence_for_beat(0.0, current_feature=nan_feature) == 0.0


def test_browser_audio_stream_adapter_rejects_start_when_feature_validator_fails() -> None:
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
    adapter.start_feature_validator = lambda _feature_vector: False

    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.ingest(voiced_frame(np, 0.08)) is False

    assert adapter.ready_to_start is False
    assert adapter.stream_state == "armed"
    assert adapter.start_streak == 0
    assert feature_queue.items == []


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

    assert adapter.ingest(voiced_frame(np, 0.08)) is False
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
    assert adapter.ingest(voiced_frame(np, 0.35)) is True
    assert adapter.ready_to_start is False
    assert adapter.ingest(voiced_frame(np, 0.35)) is True
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

    assert adapter.ingest(voiced_frame(np, 0.2)) is True
    assert adapter.ingest(voiced_frame(np, 0.2)) is True
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
    assert adapter.ingest(voiced_frame(np, 0.35)) is True
    assert adapter.ingest(voiced_frame(np, 0.35)) is True
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
        assert adapter.ingest(voiced_frame(np, 0.08)) is False

    assert adapter.ready_to_start is False
    assert feature_queue.items == []

    assert adapter.ingest(voiced_frame(np, 0.25)) is True

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
    frame = voiced_frame(np, 0.2)

    assert adapter.ingest(frame) is True

    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_raises_start_gate_for_calibrated_noise() -> None:
    import numpy as np

    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=DummyQueue(),
        np=np,
        hop_length=4,
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.025,
        start_peak_gate=0.06,
        min_active_frames=1,
        warmup_frames=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter._calibrated_rms_gate = 0.04
    adapter._calibrated_peak_gate = 0.08

    assert adapter._effective_start_gates() == pytest.approx((0.048, 0.088))


def test_browser_audio_stream_adapter_reports_warmup_environment_quality() -> None:
    import numpy as np

    def build_adapter() -> BrowserAudioStreamAdapter:
        return BrowserAudioStreamAdapter(
            processor=DummyProcessor(),
            feature_queue=DummyQueue(),
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

    quiet = build_adapter()
    noisy = build_adapter()
    poor = build_adapter()
    for _ in range(3):
        quiet.ingest(np.zeros(128, dtype=np.float32))
        noisy.ingest(np.full(128, 0.012, dtype=np.float32))
        poor.ingest(np.full(128, 0.07, dtype=np.float32))

    assert quiet.environment_quality == "good"
    assert noisy.environment_quality == "noisy"
    assert poor.environment_quality == "poor"


def test_session_armed_message_carries_environment_quality() -> None:
    assert session_armed_message("session-1", "noisy") == {
        "protocol_version": 1,
        "type": "session.armed",
        "payload": {
            "session_id": "session-1",
            "environment_quality": "noisy",
        },
    }


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


def test_browser_audio_stream_adapter_arms_after_warmup_without_waiting_for_silence() -> None:
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
    assert adapter.armed is False

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False
    assert adapter.armed is False

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False
    assert adapter.armed is True

    assert adapter.ingest(voiced_frame(np, 0.25)) is True
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


def test_alignment_engine_factory_requires_matchmaker_dependency() -> None:
    with patch("builtins.__import__", side_effect=import_without_matchmaker):
        with pytest.raises(RuntimeError, match="pymatchmaker"):
            build_alignment_engine(
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
