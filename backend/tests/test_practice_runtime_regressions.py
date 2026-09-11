from __future__ import annotations

import builtins
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.core.settings.practice_runtime import get_practice_runtime_settings
from app.processing.engines.practice_alignment.alignment_metrics import (
    beat_velocity,
    continuity_state,
    validation_confidence_ceiling,
)
from app.processing.engines.practice_alignment.acoustic_event_observation import AcousticEventObserver
from app.processing.engines.practice_alignment.audio_activity import (
    AudioGateConfig,
    AudioFrameFeatures,
)
from app.processing.engines.practice_alignment.attempt_assembler import (
    PracticeAttemptAssembler,
    ResolvedPracticeAttemptBuffer,
)
from app.processing.engines.practice_alignment.expected_group_attempt_accumulator import (
    ExpectedGroupAttemptAccumulator,
)

from app.processing.engines.practice_alignment.matchmaker_live import (
    BrowserAudioStreamAdapter,
    MatchmakerLiveEngine,
    build_alignment_engine,
)
from app.processing.engines.practice_alignment.profile import (
    PRACTICE_ALIGNMENT_RUNTIME_PROFILE_ID,
)
from app.processing.engines.practice_alignment.follow_policy import (
    WaitForNoteFollowPolicy,
)
from app.processing.engines.practice_alignment.reference_runtime import (
    build_audio_processor,
    build_score_follower,
)
from app.processing.engines.practice_alignment.reference_features import (
    slice_reference_timeline,
    trim_to_beat_range,
    trim_to_playable_start,
)
from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreEvent,
    PracticeScoreTimeline,
)
from app.processing.performance.clock import PerformanceClockState
from app.processing.performance.runtime import PerformanceRuntime
from app.processing.realtime.audio_buffer import AudioChunkBuffer
from app.processing.realtime.message_codec import session_armed_message
from app.processing.realtime.session_runtime import (
    PerformancePracticeSessionRuntime,
    PracticeSessionRuntime,
    PracticeSessionRuntimeRegistry,
)

ORIGINAL_IMPORT = builtins.__import__
GOOD_INPUT_HEALTH = {
    "available": True,
    "level": "good",
    "noise": "good",
    "confidence": 1.0,
}


def _active_stream_state() -> SimpleNamespace:
    return SimpleNamespace(
        last_audio_active=True,
        last_rms=0.1,
        last_peak=0.2,
        input_health=GOOD_INPUT_HEALTH,
        stream_state="active",
        last_feature_vector=None,
        activity_confidence_ceiling=1.0,
        last_input_policy_confidence=1.0,
        last_input_weight=1.0,
        last_frame_class="active",
        last_gate_reason="accepted",
        last_queue_decision="queued",
        last_tonal_signal=True,
        last_onset_signal=True,
        last_spectral_flatness=0.1,
        last_peak_prominence=12.0,
        last_spectral_flux=0.2,
    )


@pytest.fixture(autouse=True)
def practice_runtime_settings(monkeypatch) -> Iterator[None]:
    monkeypatch.setenv("PRACTICE_SOUNDFONT_PATH", "/tmp/noteverse-test.sf2")
    get_practice_runtime_settings.cache_clear()
    yield
    get_practice_runtime_settings.cache_clear()


class DummyAlignmentEngine:
    def ingest_audio(self, chunk: bytes):
        _ = chunk
        return None

    def reset_input_buffer(self) -> None:
        pass

    def drain_resolved_practice_attempts(self):
        return []

    def finalize_pending_practice_attempt(self, *, reason):
        _ = reason
        return []

    @property
    def is_ready_for_performance(self) -> bool:
        return False

    @property
    def input_health(self):
        return GOOD_INPUT_HEALTH

    def close(self) -> None:
        pass


class DummyReadyAlignmentEngine:
    def __init__(self) -> None:
        self._is_ready_for_performance = False

    def ingest_audio(self, chunk: bytes):
        _ = chunk
        self._is_ready_for_performance = True
        return None

    def reset_input_buffer(self) -> None:
        pass

    def drain_resolved_practice_attempts(self):
        return []

    def finalize_pending_practice_attempt(self, *, reason):
        _ = reason
        return []

    @property
    def is_ready_for_performance(self) -> bool:
        return self._is_ready_for_performance

    def close(self) -> None:
        pass


class RecordingAlignmentEngine:
    def __init__(self) -> None:
        self.reset_count = 0
        self.closed = False

    def ingest_audio(self, chunk: bytes):
        _ = chunk
        return None

    def reset_input_buffer(self) -> None:
        self.reset_count += 1

    def drain_resolved_practice_attempts(self):
        return []

    def finalize_pending_practice_attempt(self, *, reason):
        _ = reason
        return []

    @property
    def is_ready_for_performance(self) -> bool:
        return False

    def close(self) -> None:
        self.closed = True


class DrainingAlignmentEngine(DummyAlignmentEngine):
    def __init__(self) -> None:
        self.attempts = [object(), object()]

    def drain_resolved_practice_attempts(self):
        attempts = self.attempts
        self.attempts = []
        return attempts

    def finalize_pending_practice_attempt(self, *, reason):
        _ = reason
        return self.drain_resolved_practice_attempts()


class FinalizingAlignmentEngine(DummyAlignmentEngine):
    def __init__(self) -> None:
        self.reason = None
        self.attempts = [object()]

    def finalize_pending_practice_attempt(self, *, reason):
        self.reason = reason
        return self.attempts


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
    processor = build_audio_processor(
        sample_rate=16000,
        hop_length=533,
        chroma_processor=DummyProcessorFactory("chroma"),
    )

    assert processor == {"name": "chroma", "sample_rate": 16000, "hop_length": 533}


def test_matchmaker_live_engine_builds_arzt_follower() -> None:
    feature_queue = DummyQueue()
    follower = build_score_follower(
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


def test_reference_timeline_slice_derives_terminal_region_from_cropped_reference() -> None:
    import numpy as np

    reference_slice = slice_reference_timeline(
        np.array([[0.0], [1.0], [2.0], [3.0]], dtype=np.float32),
        np.array([11.59, 11.66, 11.73, 11.8], dtype=np.float32),
        score_start_beat=3.0,
        scope_start_beat=3.0,
        scope_end_beat=None,
        np=np,
    )

    assert reference_slice.start_beat == 11.59
    assert reference_slice.end_beat == 11.8
    assert reference_slice.frame_step_beat == 0.07
    assert reference_slice.terminal_region_start_beat == 11.73


def test_matchmaker_live_engine_resolves_selected_group_reference_end() -> None:
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine.score_timeline = PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-upper",
                onset_beat=12.0,
                duration_beats=0.25,
                pitches=("D5",),
                render_note_ids=("n1",),
                measure_numbers=("4",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-lower",
                onset_beat=12.0,
                duration_beats=1.0,
                pitches=("D3",),
                render_note_ids=("n2",),
                measure_numbers=("4",),
                staff_ids=("2",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-12",
                onset_beat=12.0,
                event_ids=("event-upper", "event-lower"),
                render_note_ids=("n1", "n2"),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-upper",
        first_playable_beat=12.0,
        end_beat=13.0,
    )

    assert engine._resolve_scope_reference_end_beat("entry-12") == 13.0
    assert engine._resolve_scope_reference_end_beat(None) is None


def test_matchmaker_live_engine_trims_reference_before_first_playable_note() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._score_start_beat = 3.0

    features, beats = trim_to_playable_start(
        np.array([[0.0], [1.0], [2.0], [3.0], [4.0]], dtype=np.float32),
        np.array([0.0, 1.0, 2.0, 3.0, 4.0], dtype=np.float32),
        score_start_beat=engine._score_start_beat,
        np=np,
    )

    assert features.tolist() == [[3.0], [4.0]]
    assert beats.tolist() == [3.0, 4.0]


def test_matchmaker_live_engine_trims_reference_to_selected_beat_range() -> None:
    import numpy as np

    features, beats = trim_to_beat_range(
        np.array([[0.0], [1.0], [2.0], [3.0], [4.0]], dtype=np.float32),
        np.array([3.0, 4.0, 5.0, 6.0, 7.0], dtype=np.float32),
        start_beat=4.0,
        end_beat=6.0,
        np=np,
    )

    assert features.tolist() == [[1.0], [2.0], [3.0]]
    assert beats.tolist() == [4.0, 5.0, 6.0]


def test_matchmaker_live_engine_does_not_restore_full_reference_for_empty_range() -> None:
    import numpy as np

    features, beats = trim_to_beat_range(
        np.array([[0.0], [1.0]], dtype=np.float32),
        np.array([3.0, 4.0], dtype=np.float32),
        start_beat=8.0,
        end_beat=9.0,
        np=np,
    )

    assert features.tolist() == []
    assert beats.tolist() == []


def test_matchmaker_live_engine_exposes_runtime_profile_id() -> None:
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)

    assert engine.runtime_profile_id == PRACTICE_ALIGNMENT_RUNTIME_PROFILE_ID


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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter.last_tonal_signal = True
    adapter.last_spectral_flatness = 0.29
    adapter.last_peak_prominence = 10.18

    assert adapter._has_start_signal(0.041, 0.153) is False


def test_browser_audio_stream_adapter_allows_focused_musical_start_candidate() -> None:
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
        calibration_sample_count=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter.start_feature_scorer = lambda _feature_vector: 0.99

    candidate_features = AudioFrameFeatures(
        rms=0.024,
        peak=0.07,
        tonal_signal=False,
        spectral_flatness=0.22,
        peak_prominence=48.0,
        spectral_flux=0.12,
        onset_signal=False,
        frame_class="uncertain",
    )
    adapter.feature_extractor.extract = lambda *_args, **_kwargs: candidate_features

    assert adapter.ingest(np.ones(128, dtype=np.float32)) is True

    assert adapter.ready_to_start is True
    assert adapter.last_gate_reason == "start_confirmed"


def test_browser_audio_stream_adapter_requires_strong_musical_start_after_calibration() -> None:
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
        calibration_sample_count=384,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    rng = np.random.default_rng(1)
    for _ in range(3):
        frame = rng.uniform(-0.016, 0.016, 128).astype(np.float32)
        assert adapter.ingest(frame) is False

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
        calibration_sample_count=256,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
        no_input_frames=2,
        onset_hold_frames=2,
    )

    assert adapter.stream_state == "armed"
    assert adapter.noise_estimate_warming is True
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.stream_state == "armed"
    assert adapter.noise_estimate_warming is True
    assert adapter.ingest(np.zeros(128, dtype=np.float32)) is False
    assert adapter.stream_state == "armed"
    assert adapter.noise_estimate_warming is False
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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


def test_matchmaker_live_engine_buffers_arbitrary_pcm_chunks_into_hops() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._error = None
    engine._np = np
    engine.total_bytes = 0
    engine.hop_length = 4
    engine._pending_audio = np.array([], dtype=np.float32)
    emitted_frames = []
    updates = iter([None, {"beat_position": 3.0}])
    pcm_chunks = iter(
        [
            np.array([1.0, 2.0], dtype=np.float32),
            np.array([3.0, 4.0, 5.0], dtype=np.float32),
            np.array([6.0, 7.0, 8.0, 9.0], dtype=np.float32),
        ]
    )
    engine._pcm_s16le_to_float32 = lambda _chunk: next(pcm_chunks)

    def ingest_frame(frame):
        emitted_frames.append(frame.copy())
        return next(updates)

    engine._ingest_audio_frame = ingest_frame

    assert engine.ingest_audio(b"a") is None
    assert emitted_frames == []

    assert engine.ingest_audio(b"b") is None
    assert len(emitted_frames) == 1
    assert emitted_frames[0].tolist() == [1.0, 2.0, 3.0, 4.0]
    assert engine._pending_audio.tolist() == [5.0]

    assert engine.ingest_audio(b"c") == {"beat_position": 3.0}
    assert len(emitted_frames) == 2
    assert emitted_frames[1].tolist() == [5.0, 6.0, 7.0, 8.0]
    assert engine._pending_audio.tolist() == [9.0]


def test_matchmaker_live_engine_explains_continuity_state() -> None:
    assert continuity_state(None) == "initial"
    assert continuity_state(-0.8) == "rollback"
    assert continuity_state(-0.2) == "minor_rollback"
    assert continuity_state(5.0) == "jump"
    assert continuity_state(9.0) == "large_jump"
    assert continuity_state(1.0) == "stable"


def test_matchmaker_live_engine_validation_ceiling_penalizes_unstable_continuity() -> None:
    assert (
        validation_confidence_ceiling(
            alignment_state="matched",
            continuity_state="stable",
        )
        == 1.0
    )
    assert (
        validation_confidence_ceiling(
            alignment_state="matched",
            continuity_state="jump",
        )
        == 0.5
    )
    assert (
        validation_confidence_ceiling(
            alignment_state="matched",
            continuity_state="large_jump",
        )
        == 0.3
    )
    assert (
        validation_confidence_ceiling(
            alignment_state="feature_mismatch",
            continuity_state="stable",
        )
        == 0.0
    )


def test_matchmaker_live_engine_calculates_beat_velocity() -> None:
    assert (
        beat_velocity(
            beat_delta=1.5,
            timestamp_ms=2000,
            previous_timestamp_ms=1000,
        )
        == 1.5
    )
    assert (
        beat_velocity(
            beat_delta=1.5,
            timestamp_ms=1000,
            previous_timestamp_ms=1000,
        )
        is None
    )


def test_matchmaker_live_engine_samples_decision_diagnostics(monkeypatch) -> None:
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


def test_matchmaker_live_engine_scores_initial_start_against_first_playable_beat() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._score_start_beat = 3.0
    engine._startup_entry_beats = (3.0, 3.25, 3.5)
    engine._reference_features = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float32,
    )
    engine._ref_frame_to_beat = np.array([3.0, 3.25, 3.5], dtype=np.float32)
    engine._stream = SimpleNamespace(last_feature_vector=None)
    feature_vector = np.array([0.0, 1.0, 0.0], dtype=np.float32)

    assert engine._score_start_feature(feature_vector) == 0.0
    assert engine._pending_start_anchor_beat is None

    first_playable_feature = np.array([1.0, 0.0, 0.0], dtype=np.float32)

    assert engine._score_start_feature(first_playable_feature) == 1.0
    assert engine._pending_start_anchor_beat == 3.0


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
        calibration_sample_count=0,
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


def test_browser_audio_stream_adapter_can_start_from_recent_start_feature_window() -> None:
    import numpy as np

    class SequenceProcessor:
        def __init__(self) -> None:
            self.outputs = [
                np.array([[0.8, 0.2, 0.0]], dtype=np.float32),
                np.array([[0.8, 0.2, 0.0]], dtype=np.float32),
                np.array([[0.0, 1.0, 0.0]], dtype=np.float32),
            ]

        def __call__(self, _audio):
            return self.outputs.pop(0)

    adapter = BrowserAudioStreamAdapter(
        processor=SequenceProcessor(),
        feature_queue=DummyQueue(),
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.01,
        start_peak_gate=0.04,
        min_active_frames=3,
        calibration_sample_count=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter.start_feature_scorer = lambda feature: float(feature[0])

    assert adapter.ingest(voiced_frame(np, 0.08)) is True
    assert adapter.ready_to_start is False
    assert adapter.ingest(voiced_frame(np, 0.08)) is True

    assert adapter.ready_to_start is True
    assert adapter.last_start_feature_confidence == pytest.approx(0.8)


def test_browser_audio_stream_adapter_does_not_start_from_single_tonal_feature_match() -> None:
    import numpy as np

    class SequenceProcessor:
        def __call__(self, _audio):
            return np.array([[0.99, 0.01, 0.0]], dtype=np.float32)

    adapter = BrowserAudioStreamAdapter(
        processor=SequenceProcessor(),
        feature_queue=DummyQueue(),
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.01,
        start_peak_gate=0.04,
        min_active_frames=3,
        calibration_sample_count=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter.start_feature_scorer = lambda feature: float(feature[0])

    assert adapter.ingest(voiced_frame(np, 0.08)) is True

    assert adapter.ready_to_start is False
    assert adapter.last_start_feature_confidence == pytest.approx(0.99)


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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=48,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.08, dtype=np.float32)) is False

    assert adapter.ready_to_start is False
    assert adapter.accepted_frames == 0
    assert feature_queue.items == []

    for _ in range(3):
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
        calibration_sample_count=48,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    rng = np.random.default_rng(1)
    for _ in range(3):
        frame = rng.uniform(-0.012, 0.012, 16).astype(np.float32)
        assert adapter.ingest(frame) is False

    assert adapter.ingest(np.full(16, 0.02, dtype=np.float32)) is False
    assert adapter.ready_to_start is False
    assert feature_queue.items == []

    assert adapter.ingest(voiced_frame(np, 0.2)) is True
    assert adapter.ingest(voiced_frame(np, 0.2)) is True
    assert adapter.ready_to_start is True


def test_browser_audio_stream_adapter_does_not_calibrate_from_early_performance() -> None:
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
        calibration_sample_count=48,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.08, dtype=np.float32)) is False

    assert adapter.armed is True
    assert adapter.noise_estimate_warming is True

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.001, dtype=np.float32)) is False

    assert adapter.noise_estimate_warming is False

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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
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
        calibration_sample_count=0,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )
    adapter._calibrated_rms_gate = 0.04
    adapter._calibrated_peak_gate = 0.08

    assert adapter._effective_start_gates() == pytest.approx((0.048, 0.088))


def test_browser_audio_stream_adapter_reports_calibration_input_health() -> None:
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
            calibration_sample_count=384,
            rms_noise_multiplier=4.0,
            peak_noise_multiplier=2.5,
            diagnostics_enabled=False,
        )

    quiet = build_adapter()
    noisy = build_adapter()
    high_noise = build_adapter()
    clipping = build_adapter()
    noisy_rng = np.random.default_rng(1)
    high_noise_rng = np.random.default_rng(2)
    clipping_rng = np.random.default_rng(3)
    for _ in range(3):
        quiet.ingest(np.zeros(128, dtype=np.float32))
        noisy.ingest(noisy_rng.normal(0, 0.012, 128).astype(np.float32))
        high_noise.ingest(high_noise_rng.normal(0, 0.07, 128).astype(np.float32))
        clipping.ingest(clipping_rng.uniform(-1, 1, 128).astype(np.float32))

    assert quiet.input_health == {
        "available": True,
        "level": "good",
        "noise": "good",
        "confidence": 1.0,
    }
    assert noisy.input_health == {
        "available": True,
        "level": "good",
        "noise": "elevated",
        "confidence": 0.0,
    }
    assert high_noise.input_health == {
        "available": True,
        "level": "good",
        "noise": "high",
        "confidence": 0.0,
    }
    assert clipping.input_health == {
        "available": True,
        "level": "clipping",
        "noise": "high",
        "confidence": 0.0,
    }


def test_browser_audio_stream_adapter_reports_runtime_input_health() -> None:
    import numpy as np

    adapter = BrowserAudioStreamAdapter(
        processor=DummyProcessor(),
        feature_queue=DummyQueue(),
        np=np,
        hop_length=4,
        rms_gate=0.01,
        peak_gate=0.04,
        start_rms_gate=0.08,
        start_peak_gate=0.18,
        min_active_frames=1,
        calibration_sample_count=1,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
        no_input_frames=3,
    )

    adapter.ingest(np.zeros(128, dtype=np.float32))
    assert adapter.input_health["level"] == "good"

    adapter.started = True
    adapter.performance_active = True
    adapter.last_chunk = np.zeros(adapter.hop_length, dtype=np.float32)
    for _ in range(3):
        adapter.ingest(np.zeros(128, dtype=np.float32))
    assert adapter.input_health == {
        "available": True,
        "level": "too_quiet",
        "noise": "good",
        "confidence": 1.0,
    }

    adapter.ingest(np.full(128, 1.0, dtype=np.float32))
    assert adapter.input_health["level"] == "clipping"


def test_session_armed_message_carries_input_health() -> None:
    assert session_armed_message(
        "session-1",
        {
            "available": True,
            "level": "good",
            "noise": "elevated",
            "confidence": 1.0,
        },
    ) == {
        "protocol_version": 1,
        "type": "session.armed",
        "payload": {
            "session_id": "session-1",
            "input_health": {
                "available": True,
                "level": "good",
                "noise": "elevated",
                "confidence": 1.0,
            },
        },
    }


def test_browser_audio_stream_adapter_ignores_near_gate_calibration_transients() -> None:
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
        calibration_sample_count=48,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    for _ in range(3):
        assert adapter.ingest(np.full(16, 0.014, dtype=np.float32)) is False

    assert adapter._calibrated_rms_gate == 0.015
    assert adapter._calibrated_peak_gate == 0.06


def test_browser_audio_stream_adapter_does_not_learn_early_performance_as_noise() -> None:
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
        calibration_sample_count=48,
        rms_noise_multiplier=4.0,
        peak_noise_multiplier=2.5,
        diagnostics_enabled=False,
    )

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False
    assert adapter.armed is True
    assert adapter.noise_estimate_warming is True

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False
    assert adapter.armed is True
    assert adapter.noise_estimate_warming is True

    assert adapter.ingest(np.full(16, 0.2, dtype=np.float32)) is False
    assert adapter.ready_to_start is False
    assert adapter.armed is True
    assert adapter.noise_estimate_warming is True

    for _ in range(3):
        assert adapter.ingest(np.zeros(16, dtype=np.float32)) is False

    assert adapter.armed is True
    assert adapter.noise_estimate_warming is False

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


def test_practice_runtime_registry_builds_fixed_clock_performance_runtime() -> None:
    registry = PracticeSessionRuntimeRegistry()
    performance_runtime = PerformanceRuntime(
        score_timeline=PracticeScoreTimeline(
            events=(
                PracticeScoreEvent(
                    event_id="event-1",
                    onset_beat=1.0,
                    duration_beats=1.0,
                    pitches=("C4",),
                    render_note_ids=("n1",),
                    measure_numbers=("1",),
                    staff_ids=("1",),
                    voice_ids=("1",),
                    tie_types=(),
                    playable=True,
                    entry_candidate=True,
                ),
            ),
            entry_groups=(
                PracticeEntryGroup(
                    group_id="entry-1",
                    onset_beat=1.0,
                    event_ids=("event-1",),
                    render_note_ids=("n1",),
                    entry_candidate=True,
                ),
            ),
            first_playable_event_id="event-1",
            first_playable_beat=1.0,
            end_beat=3.0,
        )
    )

    with patch(
        "app.processing.realtime.session_runtime.build_performance_runtime",
        return_value=performance_runtime,
    ) as build_runtime:
        runtime = registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
            progression_mode="CONTINUOUS",
            realtime_guidance="STATUS_ONLY",
            evaluation_profile="PERFORMANCE",
            start_expected_group_id="entry-1",
            end_expected_group_id="entry-1",
            runtime_kind="FIXED_CLOCK_PERFORMANCE",
        )

    assert isinstance(runtime, PerformancePracticeSessionRuntime)
    build_runtime.assert_called_once_with(
        score_file_path="score.xml",
        start_expected_group_id="entry-1",
        end_expected_group_id="entry-1",
    )
    sync = runtime.start_performance(now_ms=0)
    assert sync.state == PerformanceClockState.COUNT_IN
    assert sync.count_in_remaining_pulses == 4
    assert sync.scope_start_beat == 1.0
    assert registry.release("session-1") is runtime


def test_practice_runtime_registry_rejects_runtime_kind_config_mismatch() -> None:
    registry = PracticeSessionRuntimeRegistry()

    with pytest.raises(RuntimeError, match="canonical Performance config"):
        registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
            progression_mode="WAIT_FOR_NOTE",
            realtime_guidance="GUIDED",
            evaluation_profile="LEARNING",
            runtime_kind="FIXED_CLOCK_PERFORMANCE",
        )

    with pytest.raises(RuntimeError, match="canonical learning config"):
        registry.register(
            session_id="session-2",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
            progression_mode="CONTINUOUS",
            realtime_guidance="STATUS_ONLY",
            evaluation_profile="PERFORMANCE",
            runtime_kind="STEP_BY_STEP",
        )


def test_practice_runtime_emits_ready_notification_once() -> None:
    runtime = PracticeSessionRuntime(
        session_id="session-1",
        task_id="task-1",
        state="CREATED",
        score_file_path="score.xml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        progression_mode="WAIT_FOR_NOTE",
        realtime_guidance="GUIDED",
        evaluation_profile="LEARNING",
        input_source="MICROPHONE",
        audio_buffer=AudioChunkBuffer(),
        engine=DummyReadyAlignmentEngine(),
    )

    assert runtime.consume_ready_notification() is False

    runtime.process_audio_chunk(b"\x00\x00")

    assert runtime.consume_ready_notification() is True
    assert runtime.consume_ready_notification() is False


def test_practice_runtime_reset_input_buffer_clears_transport_and_engine_buffers() -> None:
    engine = RecordingAlignmentEngine()
    runtime = PracticeSessionRuntime(
        session_id="session-1",
        task_id="task-1",
        state="STREAMING",
        score_file_path="score.xml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        progression_mode="WAIT_FOR_NOTE",
        realtime_guidance="GUIDED",
        evaluation_profile="LEARNING",
        input_source="MICROPHONE",
        audio_buffer=AudioChunkBuffer(),
        engine=engine,
    )

    runtime.audio_buffer.append(b"before-pause")
    runtime.reset_input_buffer()

    assert len(runtime.audio_buffer) == 0
    assert engine.reset_count == 1


def test_practice_runtime_drains_resolved_practice_attempts() -> None:
    runtime = PracticeSessionRuntime(
        session_id="session-1",
        task_id="task-1",
        state="STREAMING",
        score_file_path="score.xml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        progression_mode="WAIT_FOR_NOTE",
        realtime_guidance="GUIDED",
        evaluation_profile="LEARNING",
        input_source="MICROPHONE",
        audio_buffer=AudioChunkBuffer(),
        engine=DrainingAlignmentEngine(),
    )

    assert len(runtime.drain_resolved_practice_attempts()) == 2
    assert runtime.drain_resolved_practice_attempts() == []


def test_practice_runtime_finalizes_pending_practice_attempts() -> None:
    engine = FinalizingAlignmentEngine()
    runtime = PracticeSessionRuntime(
        session_id="session-1",
        task_id="task-1",
        state="STREAMING",
        score_file_path="score.xml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        progression_mode="WAIT_FOR_NOTE",
        realtime_guidance="GUIDED",
        evaluation_profile="LEARNING",
        input_source="MICROPHONE",
        audio_buffer=AudioChunkBuffer(),
        engine=engine,
    )

    attempts = runtime.finalize_pending_practice_attempt(reason="practice_finished")

    assert attempts == engine.attempts
    assert engine.reason == "practice_finished"


def test_practice_runtime_close_clears_audio_buffer_before_closing_engine() -> None:
    engine = RecordingAlignmentEngine()
    runtime = PracticeSessionRuntime(
        session_id="session-1",
        task_id="task-1",
        state="STREAMING",
        score_file_path="score.xml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        progression_mode="WAIT_FOR_NOTE",
        realtime_guidance="GUIDED",
        evaluation_profile="LEARNING",
        input_source="MICROPHONE",
        audio_buffer=AudioChunkBuffer(),
        engine=engine,
    )

    runtime.audio_buffer.append(b"before-finish")
    runtime.close()

    assert len(runtime.audio_buffer) == 0
    assert engine.reset_count == 0
    assert engine.closed is True


def test_matchmaker_live_engine_reset_input_buffer_discards_partial_transport_frame() -> None:
    import numpy as np

    emitted_frames = []
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._error = None
    engine.total_bytes = 0
    engine._np = np
    engine.hop_length = 4
    engine._pending_audio = np.array([], dtype=np.float32)
    engine._pcm_s16le_to_float32 = lambda chunk: np.frombuffer(chunk, dtype=np.float32).copy()

    def ingest_frame(audio_frame):
        emitted_frames.append(audio_frame.copy())
        return None

    engine._ingest_audio_frame = ingest_frame

    engine.ingest_audio(np.array([1.0, 2.0], dtype=np.float32).tobytes())
    engine.reset_input_buffer()
    engine.ingest_audio(np.array([3.0, 4.0, 5.0, 6.0], dtype=np.float32).tobytes())

    assert [frame.tolist() for frame in emitted_frames] == [[3.0, 4.0, 5.0, 6.0]]


def test_matchmaker_live_engine_reset_input_buffer_discards_wait_for_note_event_state() -> None:
    import numpy as np

    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine._pending_audio = np.array([1.0, 2.0], dtype=np.float32)
    engine._wait_for_note_attempt = ExpectedGroupAttemptAccumulator(
        observer=AcousticEventObserver(),
        sample_rate=16000,
        np_module=np,
        window_samples=8000,
    )
    engine._wait_for_note_attempt.audio = np.array([3.0, 4.0], dtype=np.float32)
    engine._wait_for_note_attempt.frame_count = 2
    engine._wait_for_note_attempt.open = True
    engine._wait_for_note_attempt.evaluated = True
    engine._wait_for_note_attempt.release_frames = 1

    engine.reset_input_buffer()

    assert engine._pending_audio.size == 0
    assert engine._wait_for_note_attempt.audio.size == 0
    assert engine._wait_for_note_attempt.frame_count == 0
    assert engine._wait_for_note_attempt.open is False
    assert engine._wait_for_note_attempt.evaluated is False
    assert engine._wait_for_note_attempt.release_frames == 0


def make_wait_for_note_engine(np):
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    engine._np = np
    engine.sample_rate = 16000
    engine.channels = 1
    engine.total_bytes = 16000
    engine.progression_mode = "WAIT_FOR_NOTE"
    engine._last_beat_position = None
    engine._last_alignment_timestamp_ms = None
    engine._score_end_beat = 5.0
    engine._acoustic_observer = AcousticEventObserver()
    engine._wait_for_note_attempt_assembler = PracticeAttemptAssembler()
    engine._resolved_practice_attempts = ResolvedPracticeAttemptBuffer()
    engine._wait_for_note_attempt = ExpectedGroupAttemptAccumulator(
        observer=engine._acoustic_observer,
        lifecycle=engine._wait_for_note_attempt_assembler.lifecycle,
        sample_rate=16000,
        np_module=np,
        window_samples=8000,
        collection_frames=3,
        release_frame_threshold=2,
    )
    engine._follow_policy = WaitForNoteFollowPolicy(wait_for_note_timeline())
    gate_config = AudioGateConfig(
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.025,
        start_peak_gate=0.06,
        min_peak_prominence=12.0,
        onset_hold_frames=45,
    )
    engine._stream = SimpleNamespace(
        audio_gate=SimpleNamespace(config=gate_config),
        armed=True,
        last_audio_active=True,
        last_rms=0.2,
        last_peak=0.4,
        input_health=GOOD_INPUT_HEALTH,
        started=True,
        last_onset_signal=True,
        stream_state="following",
        last_frame_class="tonal",
        last_gate_reason="accepted",
        last_queue_decision="wait_for_note_evidence",
        last_tonal_signal=True,
        last_spectral_flatness=0.1,
        last_peak_prominence=20.0,
        last_spectral_flux=0.5,
        last_input_weight=1.0,
        last_input_policy_confidence=1.0,
        rms_gate=gate_config.rms_gate,
        peak_gate=gate_config.peak_gate,
        start_rms_gate=gate_config.start_rms_gate,
        start_peak_gate=gate_config.start_peak_gate,
    )
    configure_wait_for_note_candidate_stream(engine)
    return engine


def feed_wait_for_note_event(engine, frames):
    updates = []

    for audio_frame in frames:
        update = engine._ingest_audio_frame(audio_frame)
        if update is not None:
            updates.append(update)

    return updates


def configure_wait_for_note_candidate_stream(engine, *, rms: float = 0.2, peak: float = 0.4):
    frame_count = 0

    def ingest(_audio_frame):
        nonlocal frame_count
        frame_count += 1
        engine._stream.last_audio_active = True
        engine._stream.last_rms = rms
        engine._stream.last_peak = peak
        engine._stream.last_onset_signal = frame_count == 1
        engine._stream.last_gate_reason = "wait_for_note_candidate"
        engine._stream.last_queue_decision = "wait_for_note_candidate"
        engine._stream.last_frame_class = "tonal"
        engine._stream.last_tonal_signal = True
        return False

    engine._stream.ingest = ingest


def test_wait_for_note_candidate_signal_uses_audio_gate_start_energy_ratios() -> None:
    engine = MatchmakerLiveEngine.__new__(MatchmakerLiveEngine)
    gate_config = AudioGateConfig(
        rms_gate=0.015,
        peak_gate=0.06,
        start_rms_gate=0.025,
        start_peak_gate=0.06,
        min_peak_prominence=12.0,
        onset_hold_frames=45,
    )
    engine._stream = SimpleNamespace(
        audio_gate=SimpleNamespace(config=gate_config),
        last_onset_signal=False,
        start_rms_gate=0.025,
        rms_gate=0.015,
        start_peak_gate=0.06,
        peak_gate=0.06,
        last_rms=0.011,
        last_peak=0.032,
    )

    assert engine._wait_for_note_candidate_signal() is False

    engine._stream.last_rms = 0.01125
    assert engine._wait_for_note_candidate_signal() is True

    engine._stream.last_rms = 0.0
    engine._stream.last_peak = 0.033
    assert engine._wait_for_note_candidate_signal() is True


def configure_wait_for_note_silence_stream(engine):
    def ingest(_audio_frame):
        engine._stream.last_audio_active = False
        engine._stream.last_rms = 0.0
        engine._stream.last_peak = 0.0
        engine._stream.last_onset_signal = False
        engine._stream.last_gate_reason = "low_start_rms"
        engine._stream.last_queue_decision = "waiting_for_start"
        engine._stream.last_frame_class = "silence"
        engine._stream.last_tonal_signal = False
        return False

    engine._stream.ingest = ingest


def wait_for_note_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-3",
                onset_beat=3.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-4",
                onset_beat=4.0,
                duration_beats=1.0,
                pitches=("E4",),
                render_note_ids=("n2",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-0",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-1",
                onset_beat=4.0,
                event_ids=("event-4",),
                render_note_ids=("n2",),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=5.0,
    )


def sine_frame(np, frequency_hz: float, *, sample_rate: int):
    t = np.arange(int(sample_rate * 0.5), dtype=np.float32) / sample_rate
    return (0.25 * np.sin(2 * np.pi * frequency_hz * t)).astype(np.float32)


def test_wait_for_note_engine_advances_from_live_single_note_pcm() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)

    updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(3)],
    )

    assert len(updates) == 1
    update = updates[0]
    assert update is not None
    assert update["decision"]["action"] == "advance"
    assert update["decision"]["display_anchor"]["beat"] == 4.0
    assert engine._follow_policy.current_expected_group is not None
    assert engine._follow_policy.current_expected_group.pitches == ("E4",)


def test_wait_for_note_engine_holds_wrong_live_single_note_pcm() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)

    updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 293.664768, sample_rate=16000) for _ in range(3)],
    )

    assert len(updates) == 1
    update = updates[0]
    assert update is not None
    assert update["decision"]["action"] == "hold"
    assert update["decision"]["reason"] == "entry_mismatch"
    assert update["decision"]["display_anchor"]["beat"] == 3.0
    assert engine._follow_policy.current_expected_group is not None
    assert engine._follow_policy.current_expected_group.pitches == ("C4",)


def test_wait_for_note_engine_does_not_readvance_without_new_onset() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)
    first_updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(3)],
    )
    engine._stream.last_onset_signal = False

    second_update = engine._wait_for_note_update(sine_frame(np, 329.627557, sample_rate=16000))

    assert len(first_updates) == 1
    first_update = first_updates[0]
    assert first_update is not None
    assert first_update["decision"]["action"] == "advance"
    assert second_update is not None
    assert second_update["decision"]["action"] == "wait"
    assert second_update["decision"]["display_anchor"]["beat"] == 4.0
    assert engine._follow_policy.current_expected_group is not None
    assert engine._follow_policy.current_expected_group.pitches == ("E4",)


def test_wait_for_note_engine_does_not_advance_from_pre_start_candidate() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)
    engine._stream.started = False
    engine._stream.armed = True
    engine._stream.rms_gate = 0.015
    engine._stream.peak_gate = 0.06
    engine._stream.start_rms_gate = 0.025
    engine._stream.start_peak_gate = 0.06

    def pre_start_candidate(_audio_frame):
        engine._stream.last_audio_active = False
        engine._stream.last_rms = 0.2
        engine._stream.last_peak = 0.4
        engine._stream.last_onset_signal = False
        engine._stream.last_gate_reason = "waiting_for_start"
        engine._stream.last_queue_decision = "waiting_for_start"
        engine._stream.last_frame_class = "tonal"
        engine._stream.last_tonal_signal = True
        return False

    engine._stream.ingest = pre_start_candidate

    updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(3)],
    )

    assert updates == []
    assert engine._wait_for_note_attempt.open is False
    assert engine._wait_for_note_attempt.last_resolved_attempt is None
    assert engine._follow_policy.current_expected_group is not None
    assert engine._follow_policy.current_expected_group.pitches == ("C4",)


def test_wait_for_note_engine_discards_rejected_start_candidate() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)
    engine._stream.started = False
    engine._stream.armed = True
    engine._stream.rms_gate = 0.015
    engine._stream.peak_gate = 0.06
    engine._stream.start_rms_gate = 0.025
    engine._stream.start_peak_gate = 0.06

    def rejected_start_candidate(_audio_frame):
        engine._stream.last_audio_active = False
        engine._stream.last_rms = 0.2
        engine._stream.last_peak = 0.4
        engine._stream.last_onset_signal = False
        engine._stream.last_gate_reason = "start_feature_mismatch"
        engine._stream.last_queue_decision = "start_rejected"
        engine._stream.last_frame_class = "tonal"
        engine._stream.last_tonal_signal = True
        return False

    engine._stream.ingest = rejected_start_candidate

    updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(3)],
    )

    assert updates == []
    assert engine._wait_for_note_attempt.open is False
    assert engine._wait_for_note_attempt.last_resolved_attempt is None


def test_wait_for_note_engine_first_valid_strike_can_start_and_match() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)
    engine._stream.started = False
    engine._stream.armed = True
    frame_count = 0

    def valid_start_candidate(_audio_frame):
        nonlocal frame_count
        frame_count += 1
        engine._stream.started = True
        engine._stream.last_audio_active = True
        engine._stream.last_rms = 0.2
        engine._stream.last_peak = 0.4
        engine._stream.last_onset_signal = frame_count == 1
        engine._stream.last_gate_reason = "start_confirmed" if frame_count == 1 else "tonal_runtime_energy"
        engine._stream.last_queue_decision = "queued"
        engine._stream.last_frame_class = "tonal"
        engine._stream.last_tonal_signal = True
        return True

    engine._stream.ingest = valid_start_candidate

    updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(3)],
    )

    advances = [update for update in updates if update["decision"]["action"] == "advance"]
    assert len(advances) == 1
    assert advances[0]["decision"]["display_anchor"]["beat"] == 4.0


def test_wait_for_note_engine_after_start_requires_new_onset_for_next_attempt() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)
    engine._stream.started = False
    engine._stream.armed = True
    frame_count = 0

    def first_onset_then_sustain(_audio_frame):
        nonlocal frame_count
        frame_count += 1
        engine._stream.started = True
        engine._stream.last_audio_active = True
        engine._stream.last_rms = 0.2
        engine._stream.last_peak = 0.4
        engine._stream.last_onset_signal = frame_count == 1
        engine._stream.last_gate_reason = "start_confirmed" if frame_count == 1 else "tonal_runtime_energy"
        engine._stream.last_queue_decision = "queued"
        engine._stream.last_frame_class = "tonal"
        engine._stream.last_tonal_signal = True
        return True

    engine._stream.ingest = first_onset_then_sustain

    first_updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(3)],
    )
    second_updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 329.627557, sample_rate=16000) for _ in range(4)],
    )

    assert [update["decision"]["action"] for update in first_updates] == ["advance"]
    assert all(update["decision"]["action"] == "wait" for update in second_updates)
    assert engine._follow_policy.current_expected_group is not None
    assert engine._follow_policy.current_expected_group.pitches == ("E4",)


def test_wait_for_note_engine_emits_one_decision_for_sustained_correct_event() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)
    engine._stream.armed = True
    configure_wait_for_note_candidate_stream(engine)

    updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(8)],
    )

    assert len(updates) == 1
    assert updates[0]["decision"]["action"] == "advance"
    assert updates[0]["decision"]["display_anchor"]["beat"] == 4.0
    assert engine._follow_policy.current_expected_group is not None
    assert engine._follow_policy.current_expected_group.pitches == ("E4",)


def test_wait_for_note_engine_emits_one_wrong_decision_until_release() -> None:
    import numpy as np

    engine = make_wait_for_note_engine(np)
    engine._stream.armed = True
    configure_wait_for_note_candidate_stream(engine)

    wrong_updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 293.664768, sample_rate=16000) for _ in range(8)],
    )

    assert len(wrong_updates) == 1
    assert wrong_updates[0]["decision"]["action"] == "hold"
    assert wrong_updates[0]["decision"]["reason"] == "entry_mismatch"
    assert engine._follow_policy.current_expected_group is not None
    assert engine._follow_policy.current_expected_group.pitches == ("C4",)

    configure_wait_for_note_silence_stream(engine)
    silence = np.zeros(8000, dtype=np.float32)
    assert feed_wait_for_note_event(engine, [silence, silence]) == []

    configure_wait_for_note_candidate_stream(engine)
    correct_updates = feed_wait_for_note_event(
        engine,
        [sine_frame(np, 261.625565, sample_rate=16000) for _ in range(3)],
    )

    assert len(correct_updates) == 1
    assert correct_updates[0]["decision"]["action"] == "advance"
    assert correct_updates[0]["decision"]["display_anchor"]["beat"] == 4.0


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


def test_matchmaker_live_engine_rejects_continuous_progression() -> None:
    with pytest.raises(RuntimeError, match="fixed-clock"):
        MatchmakerLiveEngine(
            score_file_path="score.xml",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
            progression_mode="CONTINUOUS",
        )
