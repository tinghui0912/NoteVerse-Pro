from __future__ import annotations

import numpy as np

from app.processing.engines.practice_alignment.bytedance_step_verifier import (
    ByteDanceRawOutput,
    ByteDanceRollingStepVerifier,
    ByteDanceStepVerifierConfig,
)
from app.processing.engines.practice_alignment.step_microphone_verifier import StepVerifierTarget


class FakeByteDanceBackend:
    def __init__(self, *, frame_count: int = 220, pitch_events: dict[str, list[tuple[int, float, float]]] | None = None) -> None:
        self.frame_count = frame_count
        self.pitch_events = pitch_events or {}
        self.calls: list[tuple[int, int]] = []

    def infer_note_model(self, clips, *, sample_rate: int):
        self.calls.append((len(clips), sample_rate))
        return tuple(self._raw_output() for _clip in clips)

    def _raw_output(self):
        onsets = np.zeros((self.frame_count, 88), dtype=np.float32)
        frames = np.zeros((self.frame_count, 88), dtype=np.float32)
        for pitch, events in self.pitch_events.items():
            pitch_index = _pitch_to_midi_note(pitch) - 21
            for frame_index, onset, frame in events:
                onsets[frame_index, pitch_index] = onset
                frames[frame_index, pitch_index] = frame
        return ByteDanceRawOutput(reg_onset_output=onsets, frame_output=frames)


def test_bytedance_step_verifier_emits_timestamped_temporally_bound_observation() -> None:
    backend = FakeByteDanceBackend(pitch_events={"C4": [(160, 0.7, 0.6)]})
    verifier = ByteDanceRollingStepVerifier(backend)
    target = StepVerifierTarget(
        step_id="step-c4",
        attack_pitches=("C4",),
        continuation_pitches=(),
    )

    observation = verifier.observe_audio(_pcm16_silence(4000), target=target)

    assert observation is not None
    assert observation.step_id == "step-c4"
    assert observation.observed_attack_pitches == ("C4",)
    assert len(observation.events) == 1
    event = observation.events[0]
    assert event.pitch == "C4"
    assert event.event_sample_index == 0
    assert event.event_time_seconds == 0.0
    assert round(event.onset_score, 6) == round(float(np.float32(0.7)), 6)
    assert round(event.frame_score, 6) == round(float(np.float32(0.6)), 6)
    assert observation.decision_sample_index == 3520
    assert observation.decision_time_seconds == 0.22
    assert verifier.step_activation_boundary_sample == -1


def test_bytedance_step_verifier_requires_frame_at_onset_peak() -> None:
    backend = FakeByteDanceBackend(
        pitch_events={
            "C4": [
                (160, 0.7, 0.1),
                (164, 0.1, 0.8),
            ]
        }
    )
    verifier = ByteDanceRollingStepVerifier(backend)

    observation = verifier.observe_audio(
        _pcm16_silence(4000),
        target=StepVerifierTarget(
            step_id="step-c4",
            attack_pitches=("C4",),
            continuation_pitches=(),
        ),
    )

    assert observation is None


def test_bytedance_step_verifier_matches_all_attack_pitches_and_ignores_continuation() -> None:
    backend = FakeByteDanceBackend(
        pitch_events={
            "C4": [(160, 0.9, 0.9)],
            "F4": [(160, 0.8, 0.7)],
            "A4": [(160, 0.85, 0.75)],
        }
    )
    verifier = ByteDanceRollingStepVerifier(backend)

    observation = verifier.observe_audio(
        _pcm16_silence(4000),
        target=StepVerifierTarget(
            step_id="step-mixed",
            attack_pitches=("F4", "A4"),
            continuation_pitches=("C4",),
        ),
    )

    assert observation is not None
    assert observation.observed_attack_pitches == ("F4", "A4")
    assert tuple(event.pitch for event in observation.events) == ("F4", "A4")


def test_bytedance_step_verifier_allows_same_pitch_after_step_changes() -> None:
    backend = FakeByteDanceBackend(pitch_events={"C4": [(160, 0.7, 0.7)]})
    verifier = ByteDanceRollingStepVerifier(backend)
    first_target = StepVerifierTarget(
        step_id="step-c4-a",
        attack_pitches=("C4",),
        continuation_pitches=(),
    )
    second_target = StepVerifierTarget(
        step_id="step-c4-b",
        attack_pitches=("C4",),
        continuation_pitches=(),
    )

    first = verifier.observe_audio(_pcm16_silence(4000), target=first_target)
    later_same_step = verifier.observe_audio(_pcm16_silence(2400), target=first_target)
    before_second_anchor = verifier.observe_audio(_pcm16_silence(2400), target=second_target)
    second_step = verifier.observe_audio(_pcm16_silence(2400), target=second_target)

    assert first is not None
    assert later_same_step is not None
    assert before_second_anchor is None
    assert second_step is not None
    assert first.step_id != second_step.step_id


def _pcm16_silence(sample_count: int) -> bytes:
    return np.zeros(sample_count, dtype=np.int16).tobytes()


def _pitch_to_midi_note(pitch: str) -> int:
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    name = pitch[0]
    accidental = 0
    octave_index = 1
    if len(pitch) >= 3 and pitch[1] in {"#", "b"}:
        accidental = 1 if pitch[1] == "#" else -1
        octave_index = 2
    octave = int(pitch[octave_index:])
    return (octave + 1) * 12 + names[name] + accidental
