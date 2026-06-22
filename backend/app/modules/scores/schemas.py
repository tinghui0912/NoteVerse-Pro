from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models.score import ScoreState
from app.modules.metadata.schemas import MetadataRead
from app.modules.score_access.schemas import ScoreCapabilities


class ScoreUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    difficulty: str | None = Field(default=None, max_length=32)
    expected_version: int = Field(ge=1)


class ScoreBatchDeleteRequest(BaseModel):
    score_ids: list[str] = Field(min_length=1)


class ScoreRead(BaseModel):
    score_id: str
    title: str
    difficulty: str | None
    state: ScoreState
    version: int
    head_revision_id: str | None
    approved_revision_id: str | None
    originating_job_id: str | None
    metadata: MetadataRead | None
    capabilities: ScoreCapabilities
    created_at: datetime
    updated_at: datetime
