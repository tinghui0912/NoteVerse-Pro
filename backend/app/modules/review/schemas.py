from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.processing_job import ProcessingJobState
from app.modules.scores.schemas import ScoreTaxonomyTagInput


class ReviewArtifactRead(BaseModel):
    artifact_id: str
    filename: str
    mime_type: str | None = None
    size: int | None = None
    sha256: str | None = None
    page_number: int | None = None


class ReviewMusicXmlRead(BaseModel):
    artifact_id: str
    content: str
    mime_type: str | None = None
    sha256: str | None = None


class JobReviewRead(BaseModel):
    job_id: str
    state: ProcessingJobState
    score_id: str | None = None
    title: str | None = None
    taxonomy_tags: list[dict[str, str]]
    musicxml: ReviewMusicXmlRead | None = None
    original_images: list[ReviewArtifactRead]
    preview_images: list[ReviewArtifactRead]
    created_at: datetime
    updated_at: datetime


class ReviewConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    taxonomy_tags: list[ScoreTaxonomyTagInput] | None = None

    @field_validator("taxonomy_tags")
    @classmethod
    def normalize_taxonomy_tags(
        cls,
        value: list[ScoreTaxonomyTagInput] | None,
    ) -> list[ScoreTaxonomyTagInput] | None:
        if value is None:
            return None
        return value


class ReviewConfirmRead(BaseModel):
    score_id: str


class ReviewUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
