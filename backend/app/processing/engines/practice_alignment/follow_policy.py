"""Backend-owned display decisions for practice score following."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping, NotRequired, TypedDict

from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    PracticeEntryGroup,
    PracticeScoreTimeline,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import (
    EvaluatorEvidence,
    ExpectedEventEvaluator,
    PracticeEventEvaluation,
)
from app.processing.engines.practice_alignment.contracts import CompletionReason


AlignmentAction = Literal["advance", "hold", "relocalize", "wait"]
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
    scope_completed: NotRequired[bool]
    completion_reason: NotRequired[CompletionReason]
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
    recovery_confidence_threshold: float = 0.75
    backward_beat_tolerance: float = 0.25
    large_jump_beats: float = 4.0


@dataclass(frozen=True)
class FollowPolicyProfile:
    progression_mode: str
    config: FollowPolicyConfig
    input_source: str = "MICROPHONE"


CONTINUOUS_POLICY_PROFILE = FollowPolicyProfile(
    progression_mode="CONTINUOUS",
    config=FollowPolicyConfig(),
)
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


@dataclass(frozen=True)
class ResolvedContinuousScope:
    """Continuous-mode scope after the reference timeline has been cropped."""

    start_expected_group_id: str | None = None
    end_expected_group_id: str | None = None
    terminal_reference_region_start_beat: float | None = None


def follow_policy_for_progression(
    score_timeline: PracticeScoreTimeline,
    *,
    progression_mode: str,
    input_source: str = "MICROPHONE",
    start_expected_group_id: str | None = None,
    end_expected_group_id: str | None = None,
    continuous_scope: ResolvedContinuousScope | None = None,
) -> "FollowPolicy | WaitForNoteFollowPolicy":
    if progression_mode == CONTINUOUS_POLICY_PROFILE.progression_mode:
        scope = continuous_scope or ResolvedContinuousScope(
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
        )
        return FollowPolicy(
            score_timeline,
            profile=_profile_with_input_source(CONTINUOUS_POLICY_PROFILE, input_source),
            resolved_scope=scope,
        )
    if progression_mode == WAIT_FOR_NOTE_POLICY_PROFILE.progression_mode:
        return WaitForNoteFollowPolicy(
            score_timeline,
            profile=_profile_with_input_source(WAIT_FOR_NOTE_POLICY_PROFILE, input_source),
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
        )
    else:
        raise ValueError(f"Unsupported progression mode for live following: {progression_mode}")


class FollowPolicy:
    """Converts raw alignment telemetry into one UI display decision."""

    def __init__(
        self,
        score_timeline: PracticeScoreTimeline,
        *,
        profile: FollowPolicyProfile | None = None,
        config: FollowPolicyConfig | None = None,
        resolved_scope: ResolvedContinuousScope | None = None,
    ) -> None:
        self._timeline = score_timeline
        selected_profile = profile or FollowPolicyProfile(
            progression_mode="CUSTOM",
            config=config or FollowPolicyConfig(),
        )
        self.progression_mode = selected_profile.progression_mode
        self._config = selected_profile.config
        self._last_display_anchor: PracticeDisplayAnchor | None = None
        continuous_scope = resolved_scope or ResolvedContinuousScope()
        self._scope_start_group = self._scope_boundary_group(
            continuous_scope.start_expected_group_id
        )
        self._scope_end_group = self._scope_boundary_group(
            continuous_scope.end_expected_group_id
        )
        self._scope_start_beat = (
            None if self._scope_start_group is None else self._scope_start_group.onset_beat
        )
        self._scope_end_beat = (
            None if self._scope_end_group is None else self._scope_end_group.onset_beat
        )
        self._terminal_reference_region_start_beat = (
            self._scope_end_beat
            if continuous_scope.terminal_reference_region_start_beat is None
            else continuous_scope.terminal_reference_region_start_beat
        )
        if (
            self._scope_start_beat is not None
            and self._scope_end_beat is not None
            and self._scope_end_beat < self._scope_start_beat
        ):
            raise PracticeScopeInvalidRange(
                "Scoped practice end target must not be before the start target."
            )

    @property
    def scope_start_beat(self) -> float | None:
        return self._scope_start_beat

    @property
    def scope_end_beat(self) -> float | None:
        return self._scope_end_beat

    def _scope_boundary_group(self, expected_group_id: str | None) -> PracticeEntryGroup | None:
        if expected_group_id is None:
            return None
        group = self._timeline.entry_group_for_id(expected_group_id)
        if group is None:
            raise PracticeScopeTargetNotFound(expected_group_id)
        return group

    def decide(self, update: Mapping[str, Any]) -> AlignmentDecision:
        summary = _confidence_summary(update)
        beat_position = float(update["beat_position"])
        match_state = str(update.get("match_state", "matched"))
        audio_active = bool(update.get("audio_active", True))
        candidate_anchor = self._anchor_for_beat(beat_position)
        terminal_region_reached = self._is_at_scope_end(beat_position)
        if terminal_region_reached and self._scope_end_group is not None:
            candidate_anchor = _anchor_from_group(
                self._scope_end_group.onset_beat,
                self._scope_end_group,
            )
        if self._is_before_scope(beat_position):
            return self._decision(
                action="hold" if self._last_display_anchor is not None else "wait",
                reason="reacquiring",
                experience_state="recovering",
                display_anchor=self._last_display_anchor,
                confidence_summary=summary,
            )
        if self._is_after_scope(beat_position):
            return self._decision(
                action="hold" if self._last_display_anchor is not None else "wait",
                reason="reacquiring",
                experience_state="recovering",
                display_anchor=self._last_display_anchor,
                confidence_summary=summary,
            )

        if match_state == "lost":
            return self._decision(
                action="hold",
                reason="reacquiring",
                experience_state="lost",
                display_anchor=self._last_display_anchor,
                confidence_summary=summary,
            )

        if not audio_active or match_state in {"holding_decay", "no_input"}:
            return self._decision(
                action="hold" if self._last_display_anchor is not None else "wait",
                reason=(
                    "holding_position"
                    if self._last_display_anchor is not None
                    else "insufficient_input"
                ),
                experience_state=(
                    "recovering"
                    if self._last_display_anchor is not None
                    else "waiting_for_input"
                ),
                display_anchor=self._last_display_anchor,
                confidence_summary=summary,
            )

        confidence_values = (
            summary["visual"],
            summary["alignment"],
            summary["audio"],
            summary["continuity"],
            summary["validation"],
            summary["input_policy"],
        )
        low_confidence = min(confidence_values) < self._config.confidence_threshold
        if low_confidence:
            return self._decision(
                action="hold" if self._last_display_anchor is not None else "wait",
                reason="low_alignment_confidence",
                experience_state=(
                    "possible_wrong_note"
                    if self._last_display_anchor is not None
                    else "heard_but_uncertain"
                ),
                display_anchor=self._last_display_anchor,
                confidence_summary=summary,
            )

        last_anchor = self._last_display_anchor
        if last_anchor is None:
            return self._accept(
                "advance",
                "stable_match",
                candidate_anchor,
                summary,
                scope_completed=terminal_region_reached,
            )

        last_beat = float(last_anchor["beat"])
        is_backward = beat_position < last_beat - self._config.backward_beat_tolerance
        if is_backward:
            return self._decision(
                action="hold",
                reason="reacquiring",
                experience_state="recovering",
                display_anchor=last_anchor,
                confidence_summary=summary,
            )

        is_large_jump = beat_position > last_beat + self._config.large_jump_beats
        if is_large_jump:
            action: AlignmentAction = (
                "relocalize"
                if summary["visual"] >= self._config.recovery_confidence_threshold
                else "hold"
            )
            if action == "relocalize":
                return self._accept(
                    "relocalize",
                    "large_jump",
                    candidate_anchor,
                    summary,
                    scope_completed=terminal_region_reached,
                )
            return self._decision(
                action="hold",
                reason="large_jump",
                experience_state="recovering",
                display_anchor=last_anchor,
                confidence_summary=summary,
            )

        return self._accept(
            "advance",
            "stable_match",
            candidate_anchor,
            summary,
            scope_completed=terminal_region_reached,
        )

    def reset(self) -> None:
        self._last_display_anchor = None

    def _accept(
        self,
        action: Literal["advance", "relocalize"],
        reason: AlignmentReason,
        anchor: PracticeDisplayAnchor,
        summary: PracticeConfidenceSummary,
        scope_completed: bool,
    ) -> AlignmentDecision:
        self._last_display_anchor = anchor
        scope_completed = self._scope_end_beat is not None and scope_completed
        return self._decision(
            action=action,
            reason=reason,
            experience_state="following",
            display_anchor=anchor,
            confidence_summary=summary,
            scope_completed=scope_completed,
        )

    def _anchor_for_beat(self, beat: float) -> PracticeDisplayAnchor:
        group = self._timeline.entry_group_at_or_near(beat)
        return _anchor_from_group(beat, group)

    def _is_before_scope(self, beat: float) -> bool:
        return self._scope_start_beat is not None and beat < self._scope_start_beat

    def _is_after_scope(self, beat: float) -> bool:
        return self._scope_end_beat is not None and beat > self._scope_end_beat

    def _is_at_scope_end(self, beat: float) -> bool:
        return (
            self._scope_end_beat is not None
            and self._terminal_reference_region_start_beat is not None
            and beat >= self._terminal_reference_region_start_beat
        )

    def _decision(
        self,
        *,
        action: AlignmentAction,
        reason: AlignmentReason,
        experience_state: PracticeExperienceState,
        display_anchor: PracticeDisplayAnchor | None,
        confidence_summary: PracticeConfidenceSummary,
        scope_completed: bool = False,
    ) -> AlignmentDecision:
        decision: AlignmentDecision = {
            "action": action,
            "reason": reason,
            "experience_state": experience_state,
            "display_anchor": display_anchor,
            "confidence_summary": confidence_summary,
        }
        if scope_completed:
            decision["scope_completed"] = True
            decision["completion_reason"] = "SCOPE_END_REACHED"
        return decision


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


def _anchor_from_group(beat: float, group: PracticeEntryGroup | None) -> PracticeDisplayAnchor:
    if group is None:
        return {"beat": round(beat, 3)}
    return {
        "beat": round(group.onset_beat, 3),
        "event_id": group.event_ids[0] if group.event_ids else group.group_id,
        "group_id": group.group_id,
        "render_note_ids": list(group.render_note_ids),
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
