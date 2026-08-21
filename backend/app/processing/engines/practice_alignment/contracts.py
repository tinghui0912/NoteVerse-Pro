"""Lightweight contracts shared by Practice alignment producers and consumers."""

from __future__ import annotations

from typing import Literal, NotRequired, Protocol, TypedDict, runtime_checkable


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
    action: Literal["advance", "hold", "relocalize", "wait"]
    reason: Literal[
        "stable_match",
        "insufficient_input",
        "entry_mismatch",
        "low_alignment_confidence",
        "holding_position",
        "reacquiring",
        "large_jump",
    ]
    experience_state: Literal[
        "waiting_for_input",
        "listening",
        "following",
        "heard_but_uncertain",
        "possible_wrong_note",
        "recovering",
        "lost",
        "paused",
    ]
    display_anchor: PracticeDisplayAnchor | None
    confidence_summary: PracticeConfidenceSummary


class AlignmentUpdate(TypedDict):
    beat_position: float
    confidence: float
    alignment_confidence: float
    audio_confidence: float
    continuity_confidence: float
    visual_confidence: float
    timestamp_ms: int
    score_completed: bool
    audio_active: bool
    input_rms: float
    input_peak: float
    match_state: str
    feature_confidence: NotRequired[float]
    beat_delta: NotRequired[float | None]
    stream_state: NotRequired[str]
    frame_class: NotRequired[str]
    gate_reason: NotRequired[str]
    queue_decision: NotRequired[str]
    tonal_signal: NotRequired[bool]
    onset_signal: NotRequired[bool]
    spectral_flatness: NotRequired[float]
    peak_prominence: NotRequired[float]
    spectral_flux: NotRequired[float]
    alignment_state: NotRequired[str]
    continuity_state: NotRequired[str]
    beat_velocity: NotRequired[float | None]
    validation_confidence: NotRequired[float]
    input_weight: NotRequired[float]
    input_policy_confidence: NotRequired[float]
    decision: NotRequired[AlignmentDecision]


@runtime_checkable
class AlignmentEngine(Protocol):
    """Realtime alignment engine that consumes browser-provided audio chunks."""

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None: ...

    @property
    def is_ready_for_performance(self) -> bool: ...

    def close(self) -> None: ...
