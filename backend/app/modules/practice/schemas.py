from typing import Literal, Optional

from typing_extensions import TypedDict

from pydantic import BaseModel, Field


class CreatePracticeSessionRequest(BaseModel):
    task_id: str = Field(..., min_length=1)
    source: Literal["final", "current"] = "final"
    share_token: Optional[str] = None
    sample_rate: int = Field(default=16000, ge=1)
    channels: int = Field(default=1, ge=1)
    frame_format: str = Field(default="pcm_s16le", min_length=1)


class PracticeSessionSummary(BaseModel):
    session_id: str
    state: str
    ws_url: Optional[str] = None


class PracticeSessionDetail(BaseModel):
    session_id: str
    task_id: str
    state: str
    source: str
    share_token: Optional[str] = None
    sample_rate: int
    channels: int
    frame_format: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    last_event_index: Optional[int] = None
    last_measure_index: Optional[int] = None
    last_beat_position: Optional[float] = None
    last_confidence: Optional[float] = None
    report_status: str


class PracticeReportPayload(BaseModel):
    summary: str
    metrics: dict[str, int | float | str | None]
    recommendations: list[str]


class PracticeReportResponse(BaseModel):
    session_id: str
    report_status: str
    report_payload: Optional[PracticeReportPayload] = None


class PracticeSessionSummaryResult(TypedDict):
    session_id: str
    state: str
    ws_url: str


class PracticeSessionDetailResult(TypedDict):
    session_id: str
    task_id: str
    state: str
    source: str
    share_token: Optional[str]
    sample_rate: int
    channels: int
    frame_format: str
    started_at: Optional[str]
    finished_at: Optional[str]
    last_event_index: Optional[int]
    last_measure_index: Optional[int]
    last_beat_position: Optional[float]
    last_confidence: Optional[float]
    report_status: str


class PracticeReportResult(TypedDict):
    session_id: str
    report_status: str
    report_payload: Optional[dict[str, object]]
