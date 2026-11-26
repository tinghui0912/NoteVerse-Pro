from __future__ import annotations


from app.shared.time import Instant

from pydantic import BaseModel, ConfigDict, Field

from app.modules.import_jobs.domain import ImportJobState
from app.modules.scores.genres import Genres
from app.shared.api_model import ApiModel


class ReviewArtifactRead(BaseModel):
    artifact_id: str
    filename: str
    mime_type: str | None = None
    size: int | None = None
    page_number: int | None = None


class ReviewMusicXmlRead(BaseModel):
    artifact_id: str
    content: str
    mime_type: str | None = None


class ImportJobReviewRead(ApiModel):
    job_id: str
    state: ImportJobState
    score_id: str | None = None
    display_title: str | None = None
    genres: Genres
    musicxml: ReviewMusicXmlRead | None = None
    original_images: list[ReviewArtifactRead]
    created_at: Instant
    updated_at: Instant


class ReviewConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    display_title: str | None = Field(default=None, min_length=1, max_length=255)
    genres: Genres | None = None


class ReviewConfirmRead(ApiModel):
    score_id: str


class ReviewUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
