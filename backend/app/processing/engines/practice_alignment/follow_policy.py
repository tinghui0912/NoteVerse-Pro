"""Backend-owned display decisions for practice score following."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping, NotRequired, TypedDict

from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    PracticeScoreTimeline,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
    PracticeEventEvaluation,
)
AlignmentAction = Literal["advance", "hold", "wait"]
AlignmentReason = Literal[
    "stable_match",
    "partial_match",
    "insufficient_input",
    "entry_mismatch",
    "low_alignment_confidence",
    "holding_position",
    "reacquiring",
    "large_jump",
    "practice_paused",
    "practice_finished",
    "connection_closed",
]
PracticeExperienceState = Literal[
    "waiting_for_input",
    "listening",
    "following",
    "partially_matched",
    "heard_but_uncertain",
    "possible_wrong_note",
    "recovering",
    "lost",
    "paused",
]


class PracticeDisplayAnchor(TypedDict):
    beat: float
    event_id: NotRequired[str]
    group_id: NotRequired[str]
    render_note_ids: NotRequired[list[str]]


class PracticeConfidenceSummary(TypedDict):
    visual: float
    alignment: float
    audio: float
    continuity: float
    validation: float
    input_policy: float


class AlignmentDecision(TypedDict):
    action: AlignmentAction
    reason: AlignmentReason
    experience_state: PracticeExperienceState
    display_anchor: PracticeDisplayAnchor | None
    confidence_summary: PracticeConfidenceSummary
    attempt_state: NotRequired[Literal["pending", "resolved"]]
    attempt_id: NotRequired[str]
    attempt_sequence: NotRequired[int]
    attempt_started_at_ms: NotRequired[int]
    attempt_resolved_at_ms: NotRequired[int]
    evaluator_version: NotRequired[str]
    policy_profile_version: NotRequired[str]


@dataclass(frozen=True)
class FollowPolicyConfig:
    confidence_threshold: float = 0.55
    backward_beat_tolerance: float = 0.25
    large_jump_beats: float = 4.0


@dataclass(frozen=True)
class FollowPolicyProfile:
    progression_mode: str
    config: FollowPolicyConfig
    input_source: str = "MICROPHONE"


WAIT_FOR_NOTE_POLICY_PROFILE = FollowPolicyProfile(
    progression_mode="WAIT_FOR_NOTE",
    config=FollowPolicyConfig(confidence_threshold=0.75),
)


class PracticeScopeTargetNotFound(ValueError):
    """Raised when a scoped practice target does not exist in the score timeline."""

    def __init__(self, expected_group_id: str) -> None:
        super().__init__(
            f"Unknown scoped practice start expected group: {expected_group_id}"
        )
        self.expected_group_id = expected_group_id


class PracticeScopeInvalidRange(ValueError):
    """Raised when a scoped practice range cannot be represented in the timeline."""


def follow_policy_for_progression(
    score_timeline: PracticeScoreTimeline,
    *,
    progression_mode: str,
    input_source: str = "MICROPHONE",
    start_expected_group_id: str | None = None,
    end_expected_group_id: str | None = None,
) -> "WaitForNoteFollowPolicy":
    if progression_mode == WAIT_FOR_NOTE_POLICY_PROFILE.progression_mode:
        return WaitForNoteFollowPolicy(
            score_timeline,
            profile=_profile_with_input_source(WAIT_FOR_NOTE_POLICY_PROFILE, input_source),
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
        )
    else:
        raise ValueError(f"Unsupported progression mode for live following: {progression_mode}")


def _confidence_summary(update: Mapping[str, Any]) -> PracticeConfidenceSummary:
    return {
        "visual": _rounded_float(update.get("visual_confidence", 1.0)),
        "alignment": _rounded_float(update.get("alignment_confidence", 1.0)),
        "audio": _rounded_float(update.get("audio_confidence", 1.0)),
        "continuity": _rounded_float(update.get("continuity_confidence", 1.0)),
        "validation": _rounded_float(update.get("validation_confidence", 1.0)),
        "input_policy": _rounded_float(update.get("input_policy_confidence", 1.0)),
    }


class WaitForNoteFollowPolicy:
    """Step-by-step progression policy driven by expected-event correctness."""

    def __init__(
        self,
        score_timeline: PracticeScoreTimeline,
        *,
        profile: FollowPolicyProfile = WAIT_FOR_NOTE_POLICY_PROFILE,
        evaluator: ExpectedEventEvaluator | None = None,
        start_expected_group_id: str | None = None,
        end_expected_group_id: str | None = None,
    ) -> None:
        self._expected_groups = score_timeline.expected_practice_groups
        self._config = profile.config
        self.progression_mode = profile.progression_mode
        self.input_source = profile.input_source
        self._evaluator = evaluator or ExpectedEventEvaluator(
            confidence_threshold=self._config.confidence_threshold,
        )
        self._start_index_value = self._start_index(start_expected_group_id)
        self._end_index_value = self._end_index(end_expected_group_id)
        if self._end_index_value < self._start_index_value:
            raise PracticeScopeInvalidRange(
                "Scoped practice end target must not be before the start target."
            )
        self._current_index = self._start_index_value

    def _start_index(self, expected_group_id: str | None) -> int:
        if expected_group_id is None:
            return 0
        return self._group_index(expected_group_id)

    def _end_index(self, expected_group_id: str | None) -> int:
        if expected_group_id is None:
            return len(self._expected_groups) - 1
        return self._group_index(expected_group_id)

    def _group_index(self, expected_group_id: str) -> int:
        for index, group in enumerate(self._expected_groups):
            if group.group_id == expected_group_id:
                return index
        raise PracticeScopeTargetNotFound(expected_group_id)

    @property
    def current_expected_group(self) -> ExpectedPracticeGroup | None:
        if self._current_index > self._end_index_value:
            return None
        if self._current_index >= len(self._expected_groups):
            return None
        return self._expected_groups[self._current_index]

    @property
    def scope_start_beat(self) -> float | None:
        if not self._expected_groups:
            return None
        return self._expected_groups[self._start_index_value].onset_beat

    @property
    def scope_end_beat(self) -> float | None:
        if not self._expected_groups:
            return None
        return self._expected_groups[self._end_index_value].onset_beat

    def decide(self, update: Mapping[str, Any]) -> AlignmentDecision:
        summary = _confidence_summary(update)
        current_group = self.current_expected_group
        if current_group is None:
            return self._decision(
                action="hold",
                reason="stable_match",
                experience_state="following",
                display_anchor=None,
                confidence_summary=summary,
            )

        match_state = str(update.get("match_state", "matched"))
        audio_active = bool(update.get("audio_active", True))
        if match_state == "lost":
            return self._decision(
                action="hold",
                reason="reacquiring",
                experience_state="lost",
                display_anchor=_anchor_from_expected_group(current_group),
                confidence_summary=summary,
            )
        if not audio_active or match_state in {"holding_decay", "no_input"}:
            return self._decision(
                action="wait",
                reason="insufficient_input",
                experience_state="waiting_for_input",
                display_anchor=_anchor_from_expected_group(current_group),
                confidence_summary=summary,
            )

        return self._decision(
            action="wait",
            reason="insufficient_input",
            experience_state="listening",
            display_anchor=_anchor_from_expected_group(current_group),
            confidence_summary=summary,
        )

    def evaluate_evidence(self, evidence: EvaluatorEvidence) -> PracticeEventEvaluation:
        current_group = self.current_expected_group
        if current_group is None:
            raise ValueError("Wait For Note policy has no remaining expected groups.")

        return self._evaluator.evaluate(current_group, evidence)

    def decide_evaluation(
        self,
        *,
        evidence: EvaluatorEvidence,
        evaluation: PracticeEventEvaluation,
    ) -> AlignmentDecision:
        current_group = self.current_expected_group
        if current_group is None:
            raise ValueError("Wait For Note policy has no remaining expected groups.")

        summary: PracticeConfidenceSummary = {
            "visual": _rounded_float(evidence.confidence),
            "alignment": _rounded_float(1.0 if evidence.alignment_beat is not None else evidence.confidence),
            "audio": _rounded_float(evidence.confidence if evidence.source == "AUDIO" else 1.0),
            "continuity": 1.0,
            "validation": _rounded_float(evidence.confidence),
            "input_policy": _rounded_float(evidence.confidence),
        }
        if evaluation.result == "MATCH":
            matched_anchor = _anchor_from_expected_group(current_group)
            self._current_index += 1
            next_group = self.current_expected_group
            return self._decision(
                action="advance",
                reason="stable_match",
                experience_state="following",
                display_anchor=_anchor_from_expected_group(next_group) if next_group else matched_anchor,
                confidence_summary=summary,
            )

        if evaluation.result == "UNCERTAIN":
            return self._decision(
                action="wait",
                reason="low_alignment_confidence",
                experience_state="heard_but_uncertain",
                display_anchor=_anchor_from_expected_group(current_group),
                confidence_summary=summary,
            )

        if evaluation.result == "PARTIAL":
            if self._should_advance_best_effort_partial(current_group, evidence):
                matched_anchor = _anchor_from_expected_group(current_group)
                self._current_index += 1
                next_group = self.current_expected_group
                return self._decision(
                    action="advance",
                    reason="partial_match",
                    experience_state="following",
                    display_anchor=_anchor_from_expected_group(next_group) if next_group else matched_anchor,
                    confidence_summary=summary,
                )
            return self._decision(
                action="wait",
                reason="partial_match",
                experience_state="partially_matched",
                display_anchor=_anchor_from_expected_group(current_group),
                confidence_summary=summary,
            )

        return self._decision(
            action="hold",
            reason="entry_mismatch",
            experience_state="possible_wrong_note",
            display_anchor=_anchor_from_expected_group(current_group),
            confidence_summary=summary,
        )

    def reset(self) -> None:
        self._current_index = self._start_index_value

    def _should_advance_best_effort_partial(
        self,
        current_group: ExpectedPracticeGroup,
        evidence: EvaluatorEvidence,
    ) -> bool:
        return (
            self.input_source == "MICROPHONE"
            and evidence.source == "AUDIO"
            and len(current_group.pitches) > 1
            and bool(evidence.observed_pitches)
        )

    def _decision(
        self,
        *,
        action: AlignmentAction,
        reason: AlignmentReason,
        experience_state: PracticeExperienceState,
        display_anchor: PracticeDisplayAnchor | None,
        confidence_summary: PracticeConfidenceSummary,
    ) -> AlignmentDecision:
        return {
            "action": action,
            "reason": reason,
            "experience_state": experience_state,
            "display_anchor": display_anchor,
            "confidence_summary": confidence_summary,
        }


def _anchor_from_expected_group(group: ExpectedPracticeGroup) -> PracticeDisplayAnchor:
    return {
        "beat": round(group.onset_beat, 3),
        "event_id": group.event_ids[0] if group.event_ids else group.group_id,
        "group_id": group.group_id,
        "render_note_ids": list(group.render_note_ids),
    }


def _rounded_float(value: Any) -> float:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return 0.0


def _profile_with_input_source(profile: FollowPolicyProfile, input_source: str) -> FollowPolicyProfile:
    return FollowPolicyProfile(
        progression_mode=profile.progression_mode,
        config=profile.config,
        input_source=input_source,
    )
