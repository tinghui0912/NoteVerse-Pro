"""Versioned JSON control and server-message contract for Practice WebSockets."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


PRACTICE_WEBSOCKET_PROTOCOL_VERSION = 1


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _ProtocolEnvelope(_StrictModel):
    protocol_version: Literal[1] = 1


class ClientInitPayload(_StrictModel):
    sample_rate: int = Field(ge=1)
    channels: int = Field(ge=1)
    frame_samples: int = Field(ge=1)
    progression_mode: Literal["WAIT_FOR_NOTE", "CONTINUOUS"]
    realtime_guidance: Literal["STATUS_ONLY", "GUIDED"]
    evaluation_profile: Literal["LEARNING", "PERFORMANCE"]
    input_source: Literal["MICROPHONE", "MIDI"]


class ClientTimestampPayload(_StrictModel):
    t: int = Field(ge=0)


class ClientMidiEventPayload(_StrictModel):
    event_type: Literal["note_on", "note_off"]
    note_number: int = Field(ge=0, le=127)
    velocity: int = Field(default=0, ge=0, le=127)
    timestamp_ms: int = Field(ge=0)


class ClientInitMessage(_ProtocolEnvelope):
    type: Literal["client.init"]
    payload: ClientInitPayload


class ClientPauseMessage(_ProtocolEnvelope):
    type: Literal["client.pause"]
    payload: ClientTimestampPayload


class ClientResumeMessage(_ProtocolEnvelope):
    type: Literal["client.resume"]
    payload: ClientTimestampPayload


class ClientFinishMessage(_ProtocolEnvelope):
    type: Literal["client.finish"]
    payload: ClientTimestampPayload


class ClientHeartbeatMessage(_ProtocolEnvelope):
    type: Literal["client.heartbeat"]
    payload: ClientTimestampPayload


class ClientMidiEventMessage(_ProtocolEnvelope):
    type: Literal["client.midi_event"]
    payload: ClientMidiEventPayload


PracticeClientMessage = Annotated[
    ClientInitMessage
    | ClientPauseMessage
    | ClientResumeMessage
    | ClientFinishMessage
    | ClientHeartbeatMessage
    | ClientMidiEventMessage,
    Field(discriminator="type"),
]
practice_client_message_adapter = TypeAdapter(PracticeClientMessage)


class SessionReadyPayload(_StrictModel):
    session_id: str = Field(min_length=1)
    state: str = Field(min_length=1)


class SessionConnectingPayload(_StrictModel):
    session_id: str = Field(min_length=1)


class InputHealthPayload(_StrictModel):
    available: bool
    level: Literal["good", "too_quiet", "clipping"]
    noise: Literal["good", "elevated", "high"]
    confidence: float = Field(ge=0.0, le=1.0)


class SessionArmedPayload(_StrictModel):
    session_id: str = Field(min_length=1)
    input_health: InputHealthPayload


class SessionStatePayload(_StrictModel):
    state: str = Field(min_length=1)


class SessionCompletionOutcomePayload(_StrictModel):
    kind: Literal[
        "FULL_PIECE_LEARNING",
        "FULL_PIECE_PERFORMANCE",
        "SELECTED_SECTION",
    ]
    scope_kind: Literal["FULL_PIECE", "SELECTED_RANGE"]
    summary_artifact_kind: Literal[
        "LEARNING_SUMMARY",
        "PERFORMANCE_SUMMARY",
        "SECTION_SUMMARY",
    ]
    completion_reason: Literal["SCOPE_COMPLETED", "STOPPED_BY_USER"]
    playback_expected: bool
    summary_available: bool


class SessionFinishedPayload(_StrictModel):
    state: str = Field(min_length=1)
    completion_outcome: SessionCompletionOutcomePayload


class SessionErrorPayload(_StrictModel):
    public_code: str = Field(min_length=1)
    public_message: str = Field(min_length=1)


class PracticeDisplayAnchorPayload(_StrictModel):
    beat: float
    event_id: str | None = None
    group_id: str | None = None
    render_note_ids: list[str] = Field(default_factory=list)


class PracticeConfidenceSummaryPayload(_StrictModel):
    visual: float
    alignment: float
    audio: float
    continuity: float
    validation: float
    input_policy: float


class AlignmentDecisionPayload(_StrictModel):
    action: Literal["advance", "hold", "wait"]
    reason: Literal[
        "stable_match",
        "partial_match",
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
        "partially_matched",
        "heard_but_uncertain",
        "possible_wrong_note",
        "recovering",
        "lost",
        "paused",
    ]
    display_anchor: PracticeDisplayAnchorPayload | None
    confidence_summary: PracticeConfidenceSummaryPayload
    attempt_state: Literal["pending", "resolved"] | None = None
    attempt_id: str | None = None
    attempt_sequence: int | None = Field(default=None, ge=1)
    attempt_started_at_ms: int | None = Field(default=None, ge=0)
    attempt_resolved_at_ms: int | None = Field(default=None, ge=0)
    evaluator_version: str | None = None
    policy_profile_version: str | None = None


class AlignmentUpdatePayload(_StrictModel):
    beat_position: float
    confidence: float
    alignment_confidence: float
    audio_confidence: float
    continuity_confidence: float
    visual_confidence: float
    timestamp_ms: int = Field(ge=0)
    scope_completed: bool
    completion_reason: Literal[
        "FULL_SCORE_END_REACHED",
        "SCOPE_END_REACHED",
        "FINAL_EXPECTED_GROUP_MATCHED",
    ] | None
    audio_active: bool
    input_rms: float
    input_peak: float
    input_health: InputHealthPayload
    match_state: Literal["matched", "holding_decay", "lost", "no_input"]
    feature_confidence: float
    beat_delta: float | None
    stream_state: str = Field(min_length=1)
    frame_class: Literal["silence", "transient", "tonal", "uncertain", "unknown"]
    gate_reason: str = Field(min_length=1)
    queue_decision: str = Field(min_length=1)
    tonal_signal: bool
    onset_signal: bool
    spectral_flatness: float
    peak_prominence: float
    spectral_flux: float
    alignment_state: str = Field(min_length=1)
    continuity_state: str = Field(min_length=1)
    beat_velocity: float | None
    validation_confidence: float
    input_weight: float
    input_policy_confidence: float
    decision: AlignmentDecisionPayload


class PerformanceClockSyncPayload(_StrictModel):
    state: Literal["READY", "COUNT_IN", "RUNNING", "PAUSED", "ENDED"]
    musical_beat: float
    performance_time_ms: float = Field(ge=0.0)
    count_in_remaining_ms: float = Field(ge=0.0)
    count_in_remaining_pulses: float = Field(ge=0.0)
    scope_completed: bool
    scope_start_group_id: str | None = None
    scope_end_group_id: str | None = None
    scope_start_beat: float
    scope_terminal_beat: float
    nominal_scope_duration_ms: float = Field(ge=0.0)
    speed_ratio: float = Field(gt=0.0)


class PerformanceTimelineProjectionSegmentPayload(_StrictModel):
    start_performance_time_ms: float = Field(ge=0.0)
    end_performance_time_ms: float = Field(ge=0.0)
    start_beat: float
    end_beat: float


class PerformanceTimelineProjectionPayload(_StrictModel):
    scope_start_beat: float
    scope_terminal_beat: float
    segments: list[PerformanceTimelineProjectionSegmentPayload]


class SessionReadyMessage(_ProtocolEnvelope):
    type: Literal["session.ready"] = "session.ready"
    payload: SessionReadyPayload


class SessionConnectingMessage(_ProtocolEnvelope):
    type: Literal["session.connecting"] = "session.connecting"
    payload: SessionConnectingPayload


class SessionArmedMessage(_ProtocolEnvelope):
    type: Literal["session.armed"] = "session.armed"
    payload: SessionArmedPayload


class SessionStateChangedMessage(_ProtocolEnvelope):
    type: Literal["session.state_changed"] = "session.state_changed"
    payload: SessionStatePayload


class SessionFinishedMessage(_ProtocolEnvelope):
    type: Literal["session.finished"] = "session.finished"
    payload: SessionFinishedPayload


class SessionErrorMessage(_ProtocolEnvelope):
    type: Literal["session.error"] = "session.error"
    payload: SessionErrorPayload


class AlignmentUpdateMessage(_ProtocolEnvelope):
    type: Literal["alignment.update"] = "alignment.update"
    payload: AlignmentUpdatePayload


class PerformanceClockSyncMessage(_ProtocolEnvelope):
    type: Literal["performance.clock_sync"] = "performance.clock_sync"
    payload: PerformanceClockSyncPayload


class PerformanceTimelineMessage(_ProtocolEnvelope):
    type: Literal["performance.timeline"] = "performance.timeline"
    payload: PerformanceTimelineProjectionPayload


class PerformanceStartedMessage(_ProtocolEnvelope):
    type: Literal["performance.started"] = "performance.started"
    payload: PerformanceClockSyncPayload


class PerformancePausedMessage(_ProtocolEnvelope):
    type: Literal["performance.paused"] = "performance.paused"
    payload: PerformanceClockSyncPayload


class PerformanceResumedMessage(_ProtocolEnvelope):
    type: Literal["performance.resumed"] = "performance.resumed"
    payload: PerformanceClockSyncPayload


class PerformanceEndedMessage(_ProtocolEnvelope):
    type: Literal["performance.ended"] = "performance.ended"
    payload: PerformanceClockSyncPayload


PracticeServerMessage = Annotated[
    SessionConnectingMessage
    | SessionReadyMessage
    | SessionArmedMessage
    | SessionStateChangedMessage
    | SessionFinishedMessage
    | SessionErrorMessage
    | AlignmentUpdateMessage
    | PerformanceTimelineMessage
    | PerformanceClockSyncMessage
    | PerformanceStartedMessage
    | PerformancePausedMessage
    | PerformanceResumedMessage
    | PerformanceEndedMessage,
    Field(discriminator="type"),
]
practice_server_message_adapter = TypeAdapter(PracticeServerMessage)
