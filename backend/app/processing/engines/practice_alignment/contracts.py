"""Lightweight contracts shared by Practice alignment producers and consumers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, NotRequired, Protocol, TypedDict, runtime_checkable

if TYPE_CHECKING:
    from app.processing.engines.practice_alignment.attempt_assembler import ResolvedPracticeAttempt


InputLevel = Literal["good", "too_quiet", "clipping"]
InputNoise = Literal["good", "elevated", "high"]
CompletionReason = Literal[
    "FULL_SCORE_END_REACHED",
    "SCOPE_END_REACHED",
    "FINAL_EXPECTED_GROUP_MATCHED",
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
    action: Literal["advance", "hold", "wait", "skip"]
    reason: Literal[
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
        "user_skipped",
    ]
    experience_state: Literal[
        "waiting_for_input",
        "listening",
        "following",
        "partially_matched",
        "heard_but_uncertain",
        "possible_wrong_note",
        "recovering",
        "lost",
        "paused",
        "skipped",
    ]
    display_anchor: PracticeDisplayAnchor | None
    confidence_summary: PracticeConfidenceSummary
    attempt_state: NotRequired[Literal["pending", "resolved"]]
    attempt_id: NotRequired[str]
    attempt_sequence: NotRequired[int]
    attempt_started_at_ms: NotRequired[int]
    attempt_resolved_at_ms: NotRequired[int]
    evaluator_version: NotRequired[str]
    policy_profile_version: NotRequired[str]
    evaluation_result: NotRequired[str]
    matched_pitches: NotRequired[list[str]]
    missing_pitches: NotRequired[list[str]]
    extra_pitches: NotRequired[list[str]]


class InputHealth(TypedDict):
    available: bool
    level: InputLevel
    noise: InputNoise
    confidence: float


class AlignmentUpdate(TypedDict):
    beat_position: float
    confidence: float
    alignment_confidence: float
    audio_confidence: float
    continuity_confidence: float
    visual_confidence: float
    timestamp_ms: int
    scope_completed: bool
    completion_reason: CompletionReason | None
    audio_active: bool
    input_rms: float
    input_peak: float
    input_health: InputHealth
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

    def ingest_midi_event(
        self,
        *,
        event_type: Literal["note_on", "note_off"],
        note_number: int,
        velocity: int,
        timestamp_ms: int,
    ) -> AlignmentUpdate | None: ...

    def reset_input_buffer(self) -> None: ...

    def drain_resolved_practice_attempts(self) -> list["ResolvedPracticeAttempt"]: ...

    def finalize_pending_practice_attempt(
        self,
        *,
        reason: Literal["practice_paused", "practice_finished", "connection_closed"],
    ) -> list["ResolvedPracticeAttempt"]: ...

    def skip_current_expected_group(self) -> AlignmentUpdate | None: ...

    @property
    def is_ready_for_performance(self) -> bool: ...

    @property
    def input_health(self) -> InputHealth: ...

    def close(self) -> None: ...
