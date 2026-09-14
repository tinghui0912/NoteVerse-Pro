"""Shadow STEP microphone verifier contract.

This module defines the score-action boundary for future microphone verifiers. It
does not implement acoustic recognition and must not drive progression.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.processing.engines.practice_alignment.score_timeline import PracticeAttackStep


@dataclass(frozen=True)
class StepVerifierTarget:
    step_id: str
    attack_pitches: tuple[str, ...]
    continuation_pitches: tuple[str, ...]


@dataclass(frozen=True)
class StepVerifierObservation:
    step_id: str
    observed_attack_pitches: tuple[str, ...]
    confidence: float
    event_time: float | None = None


class StepMicrophoneVerifier(Protocol):
    def observe_audio(
        self,
        chunk: bytes,
        *,
        target: StepVerifierTarget,
    ) -> StepVerifierObservation | None: ...

    def reset(self) -> None: ...

    def close(self) -> None: ...


def step_verifier_target_from_attack_step(step: PracticeAttackStep) -> StepVerifierTarget:
    return StepVerifierTarget(
        step_id=step.step_id,
        attack_pitches=tuple(target.pitch for target in step.attack_targets),
        continuation_pitches=tuple(note.pitch for note in step.continuation),
    )
