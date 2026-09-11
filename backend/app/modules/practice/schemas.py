from typing import Literal

from pydantic import BaseModel, Field

from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeReplayArtifactKind,
    PracticeRealtimeGuidance,
    PracticeSessionCompletionReason,
    PracticeSessionSummaryStatus,
    PracticeSessionState,
)
from app.modules.practice.session_config import PracticeSessionPreset
from app.db.models.score_access import AccessOrigin


class PracticeSessionScope(BaseModel):
    start_expected_group_id: str
    end_expected_group_id: str | None = None
    start_measure_number: str | None = None
    end_measure_number: str | None = None


class PracticeTargetRead(BaseModel):
    index: int
    group_id: str
    onset_beat: float
    event_ids: list[str] = Field(default_factory=list)
    render_note_ids: list[str] = Field(default_factory=list)
    pitches: list[str] = Field(default_factory=list)
    measure_numbers: list[str] = Field(default_factory=list)
    staff_ids: list[str] = Field(default_factory=list)
    voice_ids: list[str] = Field(default_factory=list)


class PracticeTargetCatalogRead(BaseModel):
    score_id: str
    revision_id: str
    targets: list[PracticeTargetRead] = Field(default_factory=list)


class PracticeReadyScoreContentRead(BaseModel):
    score_id: str
    revision_id: str
    content: str
    mime_type: str = "application/vnd.recordare.musicxml+xml"


class CreatePracticeSessionRequest(BaseModel):
    score_id: str = Field(..., min_length=1)
    revision_id: str | None = None
    preset: PracticeSessionPreset = PracticeSessionPreset.STEP_BY_STEP
    sample_rate: int = Field(default=16000, ge=1)
    channels: int = Field(default=1, ge=1)
    frame_format: str = Field(default="pcm_s16le", min_length=1)
    input_source: PracticeInputSource = PracticeInputSource.MICROPHONE
    practice_scope: PracticeSessionScope | None = None


class PracticeSessionStartRead(BaseModel):
    session_id: str
    state: PracticeSessionState
    ws_url: str


PracticeSessionOutcomeKind = Literal[
    "FULL_PIECE_LEARNING",
    "FULL_PIECE_PERFORMANCE",
    "SELECTED_SECTION",
]
PracticeSessionScopeKind = Literal["FULL_PIECE", "SELECTED_RANGE"]
PracticeSessionSummaryArtifactKind = Literal[
    "LEARNING_SUMMARY",
    "PERFORMANCE_SUMMARY",
    "SECTION_SUMMARY",
]


class PracticeSessionCompletionOutcomeRead(BaseModel):
    kind: PracticeSessionOutcomeKind
    scope_kind: PracticeSessionScopeKind
    summary_artifact_kind: PracticeSessionSummaryArtifactKind
    completion_reason: PracticeSessionCompletionReason
    playback_expected: bool


class PracticePerformanceReportAvailabilityRead(BaseModel):
    saved_replay_available: bool
    evaluation_available: bool


class SavedPracticePerformanceRead(BaseModel):
    session_id: str
    revision_id: str
    artifact_id: str
    kind: PracticeReplayArtifactKind
    input_source: PracticeInputSource
    practice_scope: PracticeSessionScope | None = None
    started_at: str | None
    finished_at: str
    completion_reason: PracticeSessionCompletionReason
    replay_duration_ms: int
    saved_at: str
    evaluation_available: bool


class PracticeSessionDetailRead(BaseModel):
    session_id: str
    score_id: str
    revision_id: str
    access_origin: AccessOrigin
    state: PracticeSessionState
    preset: PracticeSessionPreset
    progression_mode: PracticeProgressionMode
    realtime_guidance: PracticeRealtimeGuidance
    evaluation_profile: PracticeEvaluationProfile
    input_source: PracticeInputSource
    practice_scope: PracticeSessionScope | None = None
    sample_rate: int
    channels: int
    frame_format: str
    started_at: str | None
    finished_at: str | None
    last_beat_position: float | None
    last_confidence: float | None
    summary_status: PracticeSessionSummaryStatus
    completion_outcome: PracticeSessionCompletionOutcomeRead | None
    performance_report_availability: PracticePerformanceReportAvailabilityRead | None = None


class PracticeSessionSummaryTargetRead(BaseModel):
    expected_group_id: str
    measure_numbers: list[str] = Field(default_factory=list)
    render_note_ids: list[str] = Field(default_factory=list)
    confirmed_correct_render_note_ids: list[str] = Field(default_factory=list)
    confirmed_error_render_note_ids: list[str] = Field(default_factory=list)
    missing_pitches: list[str] = Field(default_factory=list)
    unexpected_pitches: list[str] = Field(default_factory=list)
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    skipped_attempt_count: int
    matched_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    completed: bool
    completion_status: str
    last_result: str
    last_confidence: float


class PracticeSessionSummaryProblemMeasureRead(BaseModel):
    measure_number: str
    target_count: int
    completed_target_count: int
    incomplete_target_count: int
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    skipped_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    average_confidence: float | None = None


class PracticeSessionSummaryPayloadRead(BaseModel):
    metrics: dict[str, int | float | str | None]
    targets: list[PracticeSessionSummaryTargetRead] = Field(default_factory=list)
    problem_measures: list[PracticeSessionSummaryProblemMeasureRead] = Field(default_factory=list)


class PracticePerformanceTimelineSegmentRead(BaseModel):
    start_performance_time_ms: float = Field(ge=0.0)
    end_performance_time_ms: float = Field(ge=0.0)
    start_beat: float
    end_beat: float


class PracticePerformanceTimelineRead(BaseModel):
    scope_start_beat: float
    scope_terminal_beat: float
    segments: list[PracticePerformanceTimelineSegmentRead] = Field(default_factory=list)


class PracticeSessionResultSummaryRead(BaseModel):
    session_id: str
    summary_status: PracticeSessionSummaryStatus
    summary_payload: PracticeSessionSummaryPayloadRead | None
    performance_timeline: PracticePerformanceTimelineRead | None = None


class PracticeReplayUploadAuthorizationRequest(BaseModel):
    kind: PracticeReplayArtifactKind
    content_type: str
    byte_size: int
    checksum_sha256: str
    duration_ms: int
    timebase_version: int
    format_version: int


class PracticeReplayUploadAuthorizationRead(BaseModel):
    artifact_id: str
    upload_url: str
    upload_method: str
    upload_headers: dict[str, str]
    kind: PracticeReplayArtifactKind
    content_type: str
    byte_size: int
    checksum_sha256: str
    duration_ms: int
    timebase_version: int
    format_version: int


class PracticeReplayFinalizeRequest(BaseModel):
    artifact_id: str
    kind: PracticeReplayArtifactKind
    content_type: str
    byte_size: int
    checksum_sha256: str
    duration_ms: int
    timebase_version: int
    format_version: int


class SavedPracticeReplayArtifactRead(BaseModel):
    artifact_id: str
    session_id: str
    kind: PracticeReplayArtifactKind
    input_source: PracticeInputSource
    content_type: str
    byte_size: int
    checksum_sha256: str
    duration_ms: int
    timebase_version: int
    format_version: int
    created_at: str


class SavedPracticeReplayPlaybackRead(BaseModel):
    artifact_id: str
    playback_url: str
    kind: PracticeReplayArtifactKind
    content_type: str
    duration_ms: int
