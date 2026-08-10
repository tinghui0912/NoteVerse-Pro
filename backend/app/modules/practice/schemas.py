from pydantic import BaseModel, Field

from app.db.models.practice import PracticeReportStatus, PracticeSessionState
from app.db.models.score_access import AccessOrigin


class CreatePracticeSessionRequest(BaseModel):
    score_id: str = Field(..., min_length=1)
    revision_id: str | None = None
    sample_rate: int = Field(default=16000, ge=1)
    channels: int = Field(default=1, ge=1)
    frame_format: str = Field(default="pcm_s16le", min_length=1)


class PracticeSessionSummaryRead(BaseModel):
    session_id: str
    state: PracticeSessionState
    ws_url: str


class PracticeSessionDetailRead(BaseModel):
    session_id: str
    score_id: str
    revision_id: str
    access_origin: AccessOrigin
    state: PracticeSessionState
    sample_rate: int
    channels: int
    frame_format: str
    started_at: str | None
    finished_at: str | None
    last_beat_position: float | None
    last_confidence: float | None
    report_status: PracticeReportStatus


class PracticeReportPayloadRead(BaseModel):
    summary: str
    metrics: dict[str, int | float | str | None]
    recommendations: list[str]


class PracticeReportRead(BaseModel):
    session_id: str
    report_status: PracticeReportStatus
    report_payload: PracticeReportPayloadRead | None
