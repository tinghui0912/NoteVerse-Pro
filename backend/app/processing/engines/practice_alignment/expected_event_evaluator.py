"""Expected-event correctness contract for practice progression and reports."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.processing.engines.practice_alignment.score_timeline import ExpectedPracticeGroup, ScoreBeat


EvaluationResult = Literal["MATCH", "PARTIAL", "MISMATCH", "UNCERTAIN"]
ObservationSource = Literal["AUDIO", "MIDI", "SYNTHETIC"]
ProgressionAction = Literal["ADVANCE", "HOLD", "WAIT"]


@dataclass(frozen=True)
class AudioObservation:
    observed_pitches: tuple[str, ...]
    confidence: float
    onset_beat: ScoreBeat | None = None


@dataclass(frozen=True)
class MidiObservation:
    observed_pitches: tuple[str, ...]
    confidence: float = 1.0
    onset_beat: ScoreBeat | None = None


@dataclass(frozen=True)
class EvaluatorEvidence:
    observed_pitches: tuple[str, ...]
    confidence: float
    source: ObservationSource
    onset_beat: ScoreBeat | None = None
    alignment_beat: ScoreBeat | None = None

    @classmethod
    def from_audio(cls, observation: AudioObservation) -> "EvaluatorEvidence":
        return cls(
            observed_pitches=observation.observed_pitches,
            confidence=observation.confidence,
            source="AUDIO",
            onset_beat=observation.onset_beat,
        )

    @classmethod
    def from_midi(cls, observation: MidiObservation) -> "EvaluatorEvidence":
        return cls(
            observed_pitches=observation.observed_pitches,
            confidence=observation.confidence,
            source="MIDI",
            onset_beat=observation.onset_beat,
        )


@dataclass(frozen=True)
class PracticeObservation:
    expected_group_id: str
    evidence: EvaluatorEvidence


@dataclass(frozen=True)
class PracticeEventEvaluation:
    expected_group_id: str
    result: EvaluationResult
    matched_pitches: tuple[str, ...]
    missing_pitches: tuple[str, ...]
    extra_pitches: tuple[str, ...]
    confidence: float
    evaluator_version: str


@dataclass(frozen=True)
class PracticeProgressionDecision:
    expected_group_id: str
    action: ProgressionAction
    evaluation: PracticeEventEvaluation
    policy_profile_version: str


@dataclass(frozen=True)
class ExpectedEventEvaluator:
    confidence_threshold: float = 0.75
    evaluator_version: str = "expected-event-v1"

    def evaluate(
        self,
        expected_group: ExpectedPracticeGroup,
        evidence: EvaluatorEvidence,
    ) -> PracticeEventEvaluation:
        expected_pitches = tuple(dict.fromkeys(expected_group.pitches))
        observed_pitches = tuple(dict.fromkeys(evidence.observed_pitches))

        if not expected_pitches or not observed_pitches or evidence.confidence < self.confidence_threshold:
            return self._evaluation(
                expected_group,
                result="UNCERTAIN",
                matched_pitches=(),
                missing_pitches=expected_pitches,
                extra_pitches=(),
                confidence=evidence.confidence,
            )

        expected_set = set(expected_pitches)
        observed_set = set(observed_pitches)
        matched = tuple(pitch for pitch in expected_pitches if pitch in observed_set)
        missing = tuple(pitch for pitch in expected_pitches if pitch not in observed_set)
        extra = tuple(pitch for pitch in observed_pitches if pitch not in expected_set)

        if not missing and not extra:
            result: EvaluationResult = "MATCH"
        elif matched and not extra:
            result = "PARTIAL"
        else:
            result = "MISMATCH"

        return self._evaluation(
            expected_group,
            result=result,
            matched_pitches=matched,
            missing_pitches=missing,
            extra_pitches=extra,
            confidence=evidence.confidence,
        )

    def _evaluation(
        self,
        expected_group: ExpectedPracticeGroup,
        *,
        result: EvaluationResult,
        matched_pitches: tuple[str, ...],
        missing_pitches: tuple[str, ...],
        extra_pitches: tuple[str, ...],
        confidence: float,
    ) -> PracticeEventEvaluation:
        return PracticeEventEvaluation(
            expected_group_id=expected_group.group_id,
            result=result,
            matched_pitches=matched_pitches,
            missing_pitches=missing_pitches,
            extra_pitches=extra_pitches,
            confidence=confidence,
            evaluator_version=self.evaluator_version,
        )
