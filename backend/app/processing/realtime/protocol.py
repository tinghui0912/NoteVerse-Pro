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


class ClientTimestampPayload(_StrictModel):
    t: int = Field(ge=0)


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


PracticeClientMessage = Annotated[
    ClientInitMessage
    | ClientPauseMessage
    | ClientResumeMessage
    | ClientFinishMessage
    | ClientHeartbeatMessage,
    Field(discriminator="type"),
]
practice_client_message_adapter = TypeAdapter(PracticeClientMessage)


class SessionReadyPayload(_StrictModel):
    session_id: str = Field(min_length=1)
    state: str = Field(min_length=1)


class SessionConnectingPayload(_StrictModel):
    session_id: str = Field(min_length=1)


class SessionArmedPayload(_StrictModel):
    session_id: str = Field(min_length=1)
    environment_quality: Literal["good", "noisy", "poor"]


class SessionStatePayload(_StrictModel):
    state: str = Field(min_length=1)


class SessionErrorPayload(_StrictModel):
    public_code: str = Field(min_length=1)
    public_message: str = Field(min_length=1)


class AlignmentUpdatePayload(_StrictModel):
    beat_position: float
    confidence: float
    alignment_confidence: float
    audio_confidence: float
    continuity_confidence: float
    visual_confidence: float
    timestamp_ms: int = Field(ge=0)
    score_completed: bool
    audio_active: bool
    input_rms: float
    input_peak: float
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
    payload: SessionStatePayload


class SessionErrorMessage(_ProtocolEnvelope):
    type: Literal["session.error"] = "session.error"
    payload: SessionErrorPayload


class AlignmentUpdateMessage(_ProtocolEnvelope):
    type: Literal["alignment.update"] = "alignment.update"
    payload: AlignmentUpdatePayload


PracticeServerMessage = Annotated[
    SessionConnectingMessage
    | SessionReadyMessage
    | SessionArmedMessage
    | SessionStateChangedMessage
    | SessionFinishedMessage
    | SessionErrorMessage
    | AlignmentUpdateMessage,
    Field(discriminator="type"),
]
practice_server_message_adapter = TypeAdapter(PracticeServerMessage)
