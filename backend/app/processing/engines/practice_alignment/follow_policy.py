"""Backend-owned display decisions for practice score following."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, NotRequired, TypedDict

from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreTimeline,
)


AlignmentAction = Literal["advance", "hold", "relocalize", "wait"]
AlignmentReason = Literal[
    "stable_match",
    "insufficient_input",
    "low_alignment_confidence",
    "holding_position",
    "reacquiring",
    "large_jump",
]
PracticeExperienceState = Literal[
    "waiting_for_input",
    "following",
    "heard_but_uncertain",
    "possible_wrong_note",
    "recovering",
    "lost",
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


@dataclass(frozen=True)
class FollowPolicyConfig:
    confidence_threshold: float = 0.55
    recovery_confidence_threshold: float = 0.75
    backward_beat_tolerance: float = 0.25
    large_jump_beats: float = 4.0


@dataclass(frozen=True)
class FollowPolicyProfile:
    practice_mode: str
    config: FollowPolicyConfig


FREE_FOLLOW_POLICY_PROFILE = FollowPolicyProfile(
    practice_mode="FREE_FOLLOW",
    config=FollowPolicyConfig(),
)


def follow_policy_for_mode(
    score_timeline: PracticeScoreTimeline,
    *,
    practice_mode: str,
) -> "FollowPolicy":
    if practice_mode != FREE_FOLLOW_POLICY_PROFILE.practice_mode:
        raise ValueError(f"Unsupported practice mode for live following: {practice_mode}")
    return FollowPolicy(
        score_timeline,
        profile=FREE_FOLLOW_POLICY_PROFILE,
    )


class FollowPolicy:
    """Converts raw alignment telemetry into one UI display decision."""

    def __init__(
        self,
        score_timeline: PracticeScoreTimeline,
        *,
        profile: FollowPolicyProfile | None = None,
        config: FollowPolicyConfig | None = None,
    ) -> None:
        self._timeline = score_timeline
        selected_profile = profile or FollowPolicyProfile(
            practice_mode="CUSTOM",
            config=config or FollowPolicyConfig(),
        )
        self.practice_mode = selected_profile.practice_mode
        self._config = selected_profile.config
        self._last_display_anchor: PracticeDisplayAnchor | None = None

    def decide(self, update: dict[str, object]) -> AlignmentDecision:
        summary = _confidence_summary(update)
        beat_position = float(update["beat_position"])
        match_state = str(update.get("match_state", "matched"))
        audio_active = bool(update.get("audio_active", True))
        candidate_anchor = self._anchor_for_beat(beat_position)

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

        low_confidence = min(summary.values()) < self._config.confidence_threshold
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
            return self._accept("advance", "stable_match", candidate_anchor, summary)

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
                return self._accept("relocalize", "large_jump", candidate_anchor, summary)
            return self._decision(
                action="hold",
                reason="large_jump",
                experience_state="recovering",
                display_anchor=last_anchor,
                confidence_summary=summary,
            )

        return self._accept("advance", "stable_match", candidate_anchor, summary)

    def reset(self) -> None:
        self._last_display_anchor = None

    def _accept(
        self,
        action: Literal["advance", "relocalize"],
        reason: AlignmentReason,
        anchor: PracticeDisplayAnchor,
        summary: PracticeConfidenceSummary,
    ) -> AlignmentDecision:
        self._last_display_anchor = anchor
        return self._decision(
            action=action,
            reason=reason,
            experience_state="following",
            display_anchor=anchor,
            confidence_summary=summary,
        )

    def _anchor_for_beat(self, beat: float) -> PracticeDisplayAnchor:
        group = self._timeline.entry_group_at_or_near(beat)
        return _anchor_from_group(beat, group)

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


def _confidence_summary(update: dict[str, object]) -> PracticeConfidenceSummary:
    return {
        "visual": _rounded_float(update.get("visual_confidence", 1.0)),
        "alignment": _rounded_float(update.get("alignment_confidence", 1.0)),
        "audio": _rounded_float(update.get("audio_confidence", 1.0)),
        "continuity": _rounded_float(update.get("continuity_confidence", 1.0)),
        "validation": _rounded_float(update.get("validation_confidence", 1.0)),
        "input_policy": _rounded_float(update.get("input_policy_confidence", 1.0)),
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


def _rounded_float(value: object) -> float:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return 0.0
