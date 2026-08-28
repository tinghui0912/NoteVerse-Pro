from typing import Literal

from pydantic import BaseModel, Field

from app.db.models.practice import (
    PracticeEvaluationProfile,
    PracticeInputSource,
    PracticeProgressionMode,
    PracticeRealtimeGuidance,
    PracticeSessionSummaryStatus,
    PracticeSessionState,
)
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
    sample_rate: int = Field(default=16000, ge=1)
    channels: int = Field(default=1, ge=1)
    frame_format: str = Field(default="pcm_s16le", min_length=1)
    progression_mode: PracticeProgressionMode = PracticeProgressionMode.CONTINUOUS
    realtime_guidance: PracticeRealtimeGuidance = PracticeRealtimeGuidance.STATUS_ONLY
    evaluation_profile: PracticeEvaluationProfile = PracticeEvaluationProfile.PERFORMANCE
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
    playback_expected: bool
    summary_available: bool


class PracticeSessionDetailRead(BaseModel):
    session_id: str
    score_id: str
    revision_id: str
    access_origin: AccessOrigin
    state: PracticeSessionState
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


class PracticeSessionSummaryAttemptRead(BaseModel):
    attempt_index: int
    attempt_uid: str
    started_at_ms: int | None = None
    resolved_at_ms: int | None = None
    expected_group_id: str | None = None
    event_id: str | None = None
    beat_position: float
    render_note_ids: list[str] = Field(default_factory=list)
    measure_numbers: list[str] = Field(default_factory=list)
    result: str
    action: str
    completion_status: str
    scoring_included: bool
    resolution_reason: str
    input_source: str
    evidence_profile: str
    correctness_scope: str
    evaluator_version: str | None = None
    policy_profile_version: str | None = None
    confidence: float


class PracticeSessionSummaryTargetRead(BaseModel):
    expected_group_id: str
    measure_numbers: list[str] = Field(default_factory=list)
    render_note_ids: list[str] = Field(default_factory=list)
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    matched_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    completed: bool
    completion_status: str
    last_result: str
    last_confidence: float


class PracticeSessionSummaryMeasureRead(BaseModel):
    measure_number: str
    target_count: int
    completed_target_count: int
    incomplete_target_count: int
    attempt_count: int
    scorable_attempt_count: int
    interrupted_attempt_count: int
    partial_attempt_count: int
    mismatch_attempt_count: int
    average_confidence: float | None = None
    difficulty_score: float


class PracticeSessionSummaryPayloadRead(BaseModel):
    summary: str
    metrics: dict[str, int | float | str | None]
    recommendations: list[str]
    attempts: list[PracticeSessionSummaryAttemptRead] = Field(default_factory=list)
    targets: list[PracticeSessionSummaryTargetRead] = Field(default_factory=list)
    difficult_measures: list[PracticeSessionSummaryMeasureRead] = Field(default_factory=list)


class PracticeSessionResultSummaryRead(BaseModel):
    session_id: str
    summary_status: PracticeSessionSummaryStatus
    summary_payload: PracticeSessionSummaryPayloadRead | None
