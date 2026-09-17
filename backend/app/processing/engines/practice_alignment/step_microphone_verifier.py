"""STEP microphone verifier contract.

A StepMicrophoneVerifier supplies authoritative, score-target-conditioned
observations for STEP microphone progression. Only accepted observations for the
current PracticeAttackStep may create MATCH decisions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol

from app.processing.engines.practice_alignment.score_timeline import PracticeAttackStep


@dataclass(frozen=True)
class StepVerifierTarget:
    step_id: str
    attack_pitches: tuple[str, ...]
    continuation_pitches: tuple[str, ...]
    activation_generation: int = 0


@dataclass(frozen=True)
class StepVerifierEvent:
    pitch: str
    event_sample_index: int
    event_time_seconds: float
    onset_score: float
    frame_score: float


@dataclass(frozen=True)
class StepVerifierObservation:
    step_id: str
    observed_attack_pitches: tuple[str, ...]
    confidence: float
    activation_generation: int = 0
    events: tuple[StepVerifierEvent, ...] = ()
    decision_sample_index: int | None = None
    decision_time_seconds: float | None = None


class StepMicrophoneVerifier(Protocol):
    def observe_audio(
        self,
        chunk: bytes,
        *,
        target: StepVerifierTarget,
    ) -> StepVerifierObservation | None: ...

    def reset(self) -> None: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class StepMicrophoneVerifierContext:
    score_file_path: str
    sample_rate: int
    channels: int
    frame_format: str
    progression_mode: str
    realtime_guidance: str
    evaluation_profile: str
    input_source: str
    start_expected_group_id: str | None
    end_expected_group_id: str | None


StepMicrophoneVerifierFactory = Callable[
    [StepMicrophoneVerifierContext],
    StepMicrophoneVerifier,
]


def step_verifier_target_from_attack_step(
    step: PracticeAttackStep,
    *,
    activation_generation: int = 0,
) -> StepVerifierTarget:
    return StepVerifierTarget(
        step_id=step.step_id,
        attack_pitches=tuple(target.pitch for target in step.attack_targets),
        continuation_pitches=tuple(note.pitch for note in step.continuation),
        activation_generation=activation_generation,
    )
