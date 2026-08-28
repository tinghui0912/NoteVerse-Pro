"""Attempt lifecycle state for Wait For Note expected-group evaluation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.processing.engines.practice_alignment.attempt_lifecycle import (
    PracticeAttemptLifecycle,
    PracticeAttemptSnapshot,
)
from app.processing.engines.practice_alignment.acoustic_event_observation import AcousticEventObserver
from app.processing.engines.practice_alignment.expected_event_evaluator import AudioObservation
from app.processing.engines.practice_alignment.score_timeline import ScoreBeat


@dataclass
class ExpectedGroupAttemptAccumulator:
    """Collects short-lived acoustic evidence for one expected practice attempt."""

    observer: AcousticEventObserver
    sample_rate: int
    np_module: Any
    window_samples: int
    collection_frames: int = 3
    release_frame_threshold: int = 2
    audio: Any = field(init=False)
    frame_count: int = 0
    release_frames: int = 0
    open: bool = False
    evaluated: bool = False
    lifecycle: PracticeAttemptLifecycle = field(default_factory=PracticeAttemptLifecycle)
    last_resolved_attempt: PracticeAttemptSnapshot | None = None
    _observed_pitches: list[str] = field(default_factory=list, init=False)
    _confidence_by_pitch: dict[str, float] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self.audio = self.np_module.array([], dtype=self.np_module.float32)

    def reset(self) -> None:
        self.open = False
        self.evaluated = False
        self.frame_count = 0
        self.release_frames = 0
        self.lifecycle.clear_current()
        self.last_resolved_attempt = None
        self.clear_audio()
        self._observed_pitches.clear()
        self._confidence_by_pitch.clear()

    def clear_audio(self) -> None:
        self.audio = self.np_module.array([], dtype=self.np_module.float32)

    def finalize_pending(
        self,
        *,
        onset_beat: ScoreBeat,
        timestamp_ms: int,
    ) -> AudioObservation | None:
        if not self.open or self.lifecycle.current is None:
            return None

        if not self._observed_pitches and self.audio.size:
            self._merge_observation(
                self.observer.observe_mono_pcm(
                    self.audio,
                    sample_rate=self.sample_rate,
                    np_module=self.np_module,
                    onset_beat=onset_beat,
                )
            )
        self.evaluated = True
        self.last_resolved_attempt = self.lifecycle.resolve(timestamp_ms=timestamp_ms)
        return self._aggregate_observation(onset_beat)

    def observe_frame(
        self,
        audio_frame: Any,
        *,
        candidate_signal: bool,
        onset_beat: ScoreBeat,
        expected_group_id: str = "unknown",
        timestamp_ms: int = 0,
    ) -> AudioObservation | None:
        if not candidate_signal:
            if self.open:
                self.release_frames += 1
                if self.release_frames >= self.release_frame_threshold:
                    self._clear_current_attempt()
            else:
                self.clear_audio()
            return None

        if not self.open:
            self.lifecycle.begin(expected_group_id=expected_group_id, timestamp_ms=timestamp_ms)
            self.open = True
            self.evaluated = False
            self.frame_count = 0
            self.release_frames = 0
            self.last_resolved_attempt = None
            self.clear_audio()
            self._observed_pitches.clear()
            self._confidence_by_pitch.clear()
        else:
            self.release_frames = 0

        self.frame_count += 1
        self._append_audio(audio_frame)
        self._merge_observation(
            self.observer.observe_mono_pcm(
                audio_frame,
                sample_rate=self.sample_rate,
                np_module=self.np_module,
                onset_beat=onset_beat,
            )
        )

        if self.evaluated or self.frame_count < self.collection_frames:
            return None

        self.evaluated = True
        self.last_resolved_attempt = self.lifecycle.resolve(timestamp_ms=timestamp_ms)
        if not self._observed_pitches:
            self._merge_observation(
                self.observer.observe_mono_pcm(
                    self.audio,
                    sample_rate=self.sample_rate,
                    np_module=self.np_module,
                    onset_beat=onset_beat,
                )
            )
        return self._aggregate_observation(onset_beat)

    def _clear_current_attempt(self) -> None:
        self.open = False
        self.evaluated = False
        self.frame_count = 0
        self.release_frames = 0
        self.lifecycle.clear_current()
        self.clear_audio()
        self._observed_pitches.clear()
        self._confidence_by_pitch.clear()

    def _append_audio(self, audio_frame: Any) -> None:
        frame = self.np_module.asarray(audio_frame, dtype=self.np_module.float32)
        if self.audio.size:
            self.audio = self.np_module.concatenate((self.audio, frame))
        else:
            self.audio = frame
        max_samples = max(self.window_samples, int(frame.size))
        if self.audio.size > max_samples:
            self.audio = self.audio[-max_samples:]

    def _merge_observation(self, observation: AudioObservation) -> None:
        if not observation.observed_pitches or observation.confidence <= 0:
            return
        for pitch in observation.observed_pitches:
            if pitch not in self._confidence_by_pitch:
                self._observed_pitches.append(pitch)
                self._confidence_by_pitch[pitch] = observation.confidence
            else:
                self._confidence_by_pitch[pitch] = max(
                    self._confidence_by_pitch[pitch],
                    observation.confidence,
                )

    def _aggregate_observation(self, onset_beat: ScoreBeat) -> AudioObservation:
        if not self._observed_pitches:
            return AudioObservation(observed_pitches=(), confidence=0.0, onset_beat=onset_beat)
        confidence = min(self._confidence_by_pitch[pitch] for pitch in self._observed_pitches)
        return AudioObservation(
            observed_pitches=tuple(self._observed_pitches),
            confidence=confidence,
            onset_beat=onset_beat,
        )
