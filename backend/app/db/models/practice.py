import enum
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Column, DateTime, Enum as SAEnum, Float, ForeignKey, Index, String, Text
from sqlmodel import Field, Relationship, SQLModel

from app.db.models.score_access import AccessOrigin
from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .user import User


class PracticeSessionState(str, enum.Enum):
    CREATED = "CREATED"
    STREAMING = "STREAMING"
    PAUSED = "PAUSED"
    FINISHED = "FINISHED"
    FAILED = "FAILED"


class PracticeSessionSummaryStatus(str, enum.Enum):
    NOT_REQUESTED = "NOT_REQUESTED"
    PENDING = "PENDING"
    READY = "READY"
    FAILED = "FAILED"


class PracticeProgressionMode(str, enum.Enum):
    WAIT_FOR_NOTE = "WAIT_FOR_NOTE"
    CONTINUOUS = "CONTINUOUS"


class PracticeRealtimeGuidance(str, enum.Enum):
    STATUS_ONLY = "STATUS_ONLY"
    GUIDED = "GUIDED"


class PracticeEvaluationProfile(str, enum.Enum):
    LEARNING = "LEARNING"
    PERFORMANCE = "PERFORMANCE"


class PracticeInputSource(str, enum.Enum):
    MICROPHONE = "MICROPHONE"
    MIDI = "MIDI"


class PracticeAttemptResult(str, enum.Enum):
    MATCH = "MATCH"
    PARTIAL = "PARTIAL"
    MISMATCH = "MISMATCH"
    UNCERTAIN = "UNCERTAIN"
    OTHER = "OTHER"


class PracticeAttemptCompletionStatus(str, enum.Enum):
    COMPLETED = "COMPLETED"
    INTERRUPTED = "INTERRUPTED"


class PracticeAttemptResolutionReason(str, enum.Enum):
    STABLE_MATCH = "stable_match"
    PARTIAL_MATCH = "partial_match"
    ENTRY_MISMATCH = "entry_mismatch"
    LOW_ALIGNMENT_CONFIDENCE = "low_alignment_confidence"
    HOLDING_POSITION = "holding_position"
    REACQUIRING = "reacquiring"
    LARGE_JUMP = "large_jump"
    INSUFFICIENT_INPUT = "insufficient_input"
    PRACTICE_PAUSED = "practice_paused"
    PRACTICE_FINISHED = "practice_finished"
    CONNECTION_CLOSED = "connection_closed"


def _enum_values(enum_class: type[enum.Enum]) -> list[str]:
    return [str(item.value) for item in enum_class]


class PracticeSession(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_sessions"
    __table_args__ = (
        Index("idx_practice_sessions_user_created", "user_id", "created_at"),
        Index("idx_practice_sessions_revision_created", "revision_id", "created_at"),
        Index("idx_practice_sessions_state", "state"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    session_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    score_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("scores.id", ondelete="CASCADE"), nullable=False)
    )
    revision_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("score_revisions.id", ondelete="CASCADE"), nullable=False)
    )
    access_origin: AccessOrigin = Field(sa_column=Column(SAEnum(AccessOrigin, name="accessorigin"), nullable=False))
    share_grant_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("score_share_grants.id", ondelete="SET NULL")),
    )
    user_id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, ForeignKey("users.id")))
    state: PracticeSessionState = Field(sa_column=Column(SAEnum(PracticeSessionState, name="practicesessionstate"), nullable=False))
    progression_mode: PracticeProgressionMode = Field(
        default=PracticeProgressionMode.CONTINUOUS,
        sa_column=Column(
            SAEnum(PracticeProgressionMode, name="practiceprogressionmode"),
            nullable=False,
            default=PracticeProgressionMode.CONTINUOUS,
        ),
    )
    realtime_guidance: PracticeRealtimeGuidance = Field(
        default=PracticeRealtimeGuidance.STATUS_ONLY,
        sa_column=Column(
            SAEnum(PracticeRealtimeGuidance, name="practicerealtimeguidance"),
            nullable=False,
            default=PracticeRealtimeGuidance.STATUS_ONLY,
        ),
    )
    evaluation_profile: PracticeEvaluationProfile = Field(
        default=PracticeEvaluationProfile.PERFORMANCE,
        sa_column=Column(
            SAEnum(PracticeEvaluationProfile, name="practiceevaluationprofile"),
            nullable=False,
            default=PracticeEvaluationProfile.PERFORMANCE,
        ),
    )
    input_source: PracticeInputSource = Field(
        default=PracticeInputSource.MICROPHONE,
        sa_column=Column(
            SAEnum(PracticeInputSource, name="practiceinputsource"),
            nullable=False,
            default=PracticeInputSource.MICROPHONE,
        ),
    )
    sample_rate: int = Field(sa_column=Column(BigInteger, nullable=False))
    channels: int = Field(sa_column=Column(BigInteger, nullable=False))
    frame_format: str = Field(sa_column=Column(String(32), nullable=False))
    scope_start_expected_group_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    scope_end_expected_group_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    scope_start_measure_number: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    scope_end_measure_number: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    finished_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_beat_position: Optional[float] = Field(default=None, sa_column=Column(Float))
    last_confidence: Optional[float] = Field(default=None, sa_column=Column(Float))
    audio_path: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    summary_status: PracticeSessionSummaryStatus = Field(
        sa_column=Column(
            SAEnum(PracticeSessionSummaryStatus, name="practicesessionsummarystatus"),
            nullable=False,
        )
    )
    summary_payload: Optional[str] = Field(default=None, sa_column=Column(Text))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, nullable=False))
    updated_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False))

    user: Optional["User"] = Relationship(back_populates="practice_sessions")


class PracticeAttempt(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_attempts"
    __table_args__ = (
        Index("idx_practice_attempts_session_index", "session_id", "attempt_index"),
        Index("idx_practice_attempts_session_group", "session_id", "expected_group_id"),
        Index("uq_practice_attempts_session_uid", "session_id", "attempt_uid", unique=True),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    session_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False)
    )
    attempt_index: int = Field(sa_column=Column(BigInteger, nullable=False))
    attempt_uid: str = Field(sa_column=Column(String(160), nullable=False))
    started_at_ms: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    resolved_at_ms: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    expected_group_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    event_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    beat_position: float = Field(sa_column=Column(Float, nullable=False))
    render_note_ids: Optional[str] = Field(default=None, sa_column=Column(Text))
    measure_numbers: Optional[str] = Field(default=None, sa_column=Column(Text))
    result: PracticeAttemptResult = Field(
        sa_column=Column(SAEnum(PracticeAttemptResult, name="practiceattemptresult"), nullable=False)
    )
    action: str = Field(sa_column=Column(String(32), nullable=False))
    completion_status: PracticeAttemptCompletionStatus = Field(
        sa_column=Column(
            SAEnum(PracticeAttemptCompletionStatus, name="practiceattemptcompletionstatus"),
            nullable=False,
        )
    )
    resolution_reason: PracticeAttemptResolutionReason = Field(
        sa_column=Column(
            SAEnum(
                PracticeAttemptResolutionReason,
                name="practiceattemptresolutionreason",
                values_callable=_enum_values,
            ),
            nullable=False,
        )
    )
    experience_state: str = Field(sa_column=Column(String(64), nullable=False))
    input_source: PracticeInputSource = Field(
        sa_column=Column(SAEnum(PracticeInputSource, name="practiceinputsource"), nullable=False)
    )
    evidence_profile: str = Field(sa_column=Column(String(64), nullable=False))
    correctness_scope: str = Field(sa_column=Column(String(128), nullable=False))
    evaluator_version: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    policy_profile_version: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    confidence: float = Field(sa_column=Column(Float, nullable=False))
    validation_confidence: Optional[float] = Field(default=None, sa_column=Column(Float))
    input_policy_confidence: Optional[float] = Field(default=None, sa_column=Column(Float))
    timestamp_ms: int = Field(sa_column=Column(BigInteger, nullable=False))
    created_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, nullable=False))
