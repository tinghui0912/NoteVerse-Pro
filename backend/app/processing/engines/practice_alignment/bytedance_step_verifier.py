"""Research-only ByteDance STEP microphone verifier adapter.

The adapter implements the score-aware rolling formulation behind the
``StepMicrophoneVerifier`` boundary. It is not wired into production builders.
"""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Protocol

import numpy as np

from app.processing.engines.practice_alignment.step_microphone_verifier import (
    StepMicrophoneVerifier,
    StepVerifierEvent,
    StepVerifierObservation,
    StepVerifierTarget,
)


@dataclass(frozen=True)
class ByteDanceStepVerifierConfig:
    sample_rate: int = 16000
    lookback_seconds: float = 1.0
    target_anchor_seconds: float = 1.6
    future_seconds: float = 0.22
    onset_threshold: float = 0.2
    frame_threshold: float = 0.2
    cadence_seconds: float = 0.150
    event_dedupe_seconds: float = 0.050
    local_pre_seconds: float = 0.050
    local_post_seconds: float = 0.120
    output_frame_rate_hz: float = 100.0


@dataclass(frozen=True)
class ByteDanceRawOutput:
    reg_onset_output: np.ndarray
    frame_output: np.ndarray


class ByteDanceNoteModelBackend(Protocol):
    def infer_note_model(
        self,
        clips: tuple[np.ndarray, ...],
        *,
        sample_rate: int,
    ) -> tuple[ByteDanceRawOutput, ...]: ...


@dataclass(frozen=True)
class ByteDanceStepVerifierLatency:
    anchor_sample_index: int
    inference_ms: float
    evidence_ms: float


class ByteDanceRollingStepVerifier(StepMicrophoneVerifier):
    """Rolling score-aware adapter for ByteDance note_model raw outputs.

    A STEP may only consume onset events that occurred after the STEP became
    active. This is intentional product semantics, not an attempt to reproduce
    older research rows that allowed pre-activation events to satisfy a later
    step.
    """

    def __init__(
        self,
        backend: ByteDanceNoteModelBackend,
        *,
        config: ByteDanceStepVerifierConfig = ByteDanceStepVerifierConfig(),
    ) -> None:
        self._backend = backend
        self._config = config
        self._buffer = np.array([], dtype=np.float32)
        self._buffer_start_sample = 0
        self._absolute_sample_cursor = 0
        self._next_anchor_sample = 0
        self._active_step_id: str | None = None
        self._step_activation_boundary_sample = 0
        self._consumed_through_sample = 0
        self._last_emitted_sample_by_pitch: dict[str, int] = {}
        self._latencies: list[ByteDanceStepVerifierLatency] = []

    def observe_audio(
        self,
        chunk: bytes,
        *,
        target: StepVerifierTarget,
    ) -> StepVerifierObservation | None:
        if self._active_step_id != target.step_id:
            self._active_step_id = target.step_id
            self._step_activation_boundary_sample = self._absolute_sample_cursor - 1
            self._consumed_through_sample = self._step_activation_boundary_sample
            self._last_emitted_sample_by_pitch = {}

        samples = self._pcm_s16le_to_float32(chunk)
        if samples.size:
            self._append_samples(samples)

        latest_observation: StepVerifierObservation | None = None
        for anchor_sample in self._ready_anchor_samples():
            inference_started = perf_counter()
            clip, clip_start_sample = self._fixed_anchor_clip(anchor_sample)
            (raw_output,) = self._backend.infer_note_model((clip,), sample_rate=self._config.sample_rate)
            inference_ms = (perf_counter() - inference_started) * 1000.0
            evidence_started = perf_counter()
            observation = self._observation_from_raw_output(
                raw_output,
                target=target,
                anchor_sample=anchor_sample,
                clip_start_sample=clip_start_sample,
            )
            evidence_ms = (perf_counter() - evidence_started) * 1000.0
            self._latencies.append(
                ByteDanceStepVerifierLatency(
                    anchor_sample_index=anchor_sample,
                    inference_ms=inference_ms,
                    evidence_ms=evidence_ms,
                )
            )
            if observation is not None:
                latest_observation = observation
        self._trim_buffer()
        return latest_observation

    def reset(self) -> None:
        self._buffer = np.array([], dtype=np.float32)
        self._buffer_start_sample = self._absolute_sample_cursor
        self._next_anchor_sample = self._absolute_sample_cursor
        self._active_step_id = None
        self._step_activation_boundary_sample = self._absolute_sample_cursor
        self._consumed_through_sample = self._absolute_sample_cursor
        self._last_emitted_sample_by_pitch = {}

    def close(self) -> None:
        pass

    def drain_latencies(self) -> list[ByteDanceStepVerifierLatency]:
        latencies = self._latencies
        self._latencies = []
        return latencies

    @property
    def absolute_sample_cursor(self) -> int:
        return self._absolute_sample_cursor

    @property
    def active_step_id(self) -> str | None:
        return self._active_step_id

    @property
    def step_activation_boundary_sample(self) -> int:
        return self._step_activation_boundary_sample

    def _pcm_s16le_to_float32(self, chunk: bytes) -> np.ndarray:
        if not chunk:
            return np.array([], dtype=np.float32)
        samples = np.frombuffer(chunk, dtype=np.int16)
        return (samples.astype(np.float32) / 32768.0).copy()

    def _append_samples(self, samples: np.ndarray) -> None:
        self._buffer = np.concatenate((self._buffer, samples.astype(np.float32, copy=False)))
        self._absolute_sample_cursor += int(samples.size)

    def _ready_anchor_samples(self) -> tuple[int, ...]:
        ready_until = self._absolute_sample_cursor - self._seconds_to_samples(self._config.future_seconds)
        anchors: list[int] = []
        cadence_samples = max(1, self._seconds_to_samples(self._config.cadence_seconds))
        while self._next_anchor_sample <= ready_until:
            anchors.append(self._next_anchor_sample)
            self._next_anchor_sample += cadence_samples
        return tuple(anchors)

    def _fixed_anchor_clip(self, anchor_sample: int) -> tuple[np.ndarray, int]:
        lookback_samples = self._seconds_to_samples(self._config.lookback_seconds)
        future_samples = self._seconds_to_samples(self._config.future_seconds)
        target_anchor_samples = self._seconds_to_samples(self._config.target_anchor_seconds)

        available_real_lookback = min(lookback_samples, max(0, anchor_sample))
        real_start = anchor_sample - available_real_lookback
        real_end = anchor_sample + future_samples
        real_audio = self._slice_samples(real_start, real_end)
        zero_pad_samples = target_anchor_samples - available_real_lookback
        zero_pad = np.zeros(max(0, zero_pad_samples), dtype=np.float32)
        return np.concatenate((zero_pad, real_audio)), anchor_sample - target_anchor_samples

    def _slice_samples(self, start_sample: int, end_sample: int) -> np.ndarray:
        if start_sample < self._buffer_start_sample:
            missing = self._buffer_start_sample - start_sample
            prefix = np.zeros(missing, dtype=np.float32)
            start_sample = self._buffer_start_sample
        else:
            prefix = np.array([], dtype=np.float32)

        if end_sample > self._absolute_sample_cursor:
            raise ValueError("ByteDance verifier attempted to read future audio.")

        local_start = max(0, start_sample - self._buffer_start_sample)
        local_end = max(local_start, end_sample - self._buffer_start_sample)
        return np.concatenate((prefix, self._buffer[local_start:local_end]))

    def _observation_from_raw_output(
        self,
        raw_output: ByteDanceRawOutput,
        *,
        target: StepVerifierTarget,
        anchor_sample: int,
        clip_start_sample: int,
    ) -> StepVerifierObservation | None:
        events: list[StepVerifierEvent] = []
        for pitch in target.attack_pitches:
            event = self._pitch_event(
                raw_output,
                pitch=pitch,
                anchor_sample=anchor_sample,
                clip_start_sample=clip_start_sample,
            )
            if event is None:
                return None
            events.append(event)

        if not events:
            return None
        event_boundary_sample = max(
            self._consumed_through_sample,
            self._step_activation_boundary_sample,
        )
        if any(event.event_sample_index <= event_boundary_sample for event in events):
            return None
        if any(not self._passes_dedupe(event) for event in events):
            return None

        latest_sample = max(event.event_sample_index for event in events)
        self._consumed_through_sample = latest_sample + self._seconds_to_samples(
            self._config.event_dedupe_seconds
        )
        for event in events:
            self._last_emitted_sample_by_pitch[event.pitch] = event.event_sample_index

        return StepVerifierObservation(
            step_id=target.step_id,
            observed_attack_pitches=tuple(event.pitch for event in events),
            confidence=min(event.onset_score for event in events),
            events=tuple(events),
            decision_sample_index=anchor_sample
            + self._seconds_to_samples(self._config.future_seconds),
            decision_time_seconds=(
                anchor_sample + self._seconds_to_samples(self._config.future_seconds)
            )
            / self._config.sample_rate,
        )

    def _pitch_event(
        self,
        raw_output: ByteDanceRawOutput,
        *,
        pitch: str,
        anchor_sample: int,
        clip_start_sample: int,
    ) -> StepVerifierEvent | None:
        onsets = raw_output.reg_onset_output
        frames = raw_output.frame_output
        frame_count = int(onsets.shape[0])
        pitch_index = _pitch_to_midi_note(pitch) - 21
        if pitch_index < 0 or pitch_index >= int(onsets.shape[1]):
            return None

        frame_samples = (
            np.arange(frame_count, dtype=np.float64) / self._config.output_frame_rate_hz
        ) * self._config.sample_rate
        frame_samples = np.rint(frame_samples).astype(np.int64) + clip_start_sample
        local_start = anchor_sample - self._seconds_to_samples(self._config.local_pre_seconds)
        local_end = anchor_sample + self._seconds_to_samples(self._config.local_post_seconds)
        frame_mask = (frame_samples >= local_start) & (frame_samples <= local_end)
        if not np.any(frame_mask):
            return None

        local_onsets = onsets[frame_mask, pitch_index]
        local_frames = frames[frame_mask, pitch_index]
        local_frame_samples = frame_samples[frame_mask]
        onset_argmax = int(np.argmax(local_onsets))
        onset_score = float(local_onsets[onset_argmax])
        frame_score = float(local_frames[onset_argmax])
        if onset_score < self._config.onset_threshold or frame_score < self._config.frame_threshold:
            return None

        event_sample = int(local_frame_samples[onset_argmax])
        return StepVerifierEvent(
            pitch=pitch,
            event_sample_index=event_sample,
            event_time_seconds=event_sample / self._config.sample_rate,
            onset_score=onset_score,
            frame_score=frame_score,
        )

    def _passes_dedupe(self, event: StepVerifierEvent) -> bool:
        previous = self._last_emitted_sample_by_pitch.get(event.pitch)
        if previous is None:
            return True
        return (
            event.event_sample_index - previous
        ) > self._seconds_to_samples(self._config.event_dedupe_seconds)

    def _trim_buffer(self) -> None:
        keep_from = max(
            0,
            self._next_anchor_sample
            - self._seconds_to_samples(self._config.lookback_seconds)
            - self._seconds_to_samples(self._config.target_anchor_seconds),
        )
        if keep_from <= self._buffer_start_sample:
            return
        drop = min(int(keep_from - self._buffer_start_sample), int(self._buffer.size))
        if drop <= 0:
            return
        self._buffer = self._buffer[drop:]
        self._buffer_start_sample += drop

    def _seconds_to_samples(self, seconds: float) -> int:
        return int(round(seconds * self._config.sample_rate))


def _pitch_to_midi_note(pitch: str) -> int:
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    if len(pitch) < 2:
        raise ValueError(f"invalid pitch {pitch}")
    name = pitch[0]
    accidental = 0
    octave_index = 1
    if len(pitch) >= 3 and pitch[1] in {"#", "b"}:
        accidental = 1 if pitch[1] == "#" else -1
        octave_index = 2
    octave = int(pitch[octave_index:])
    return (octave + 1) * 12 + names[name] + accidental
