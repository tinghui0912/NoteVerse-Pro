from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models.score import ScoreState
from app.modules.metadata.schemas import MetadataRead
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.scores.taxonomy import ordered_unique_pairs, validate_taxonomy_pair


class ScoreTaxonomyTagRead(BaseModel):
    category: str
    code: str
    source: str
    confidence: float | None = None


class ScoreTaxonomyTagInput(BaseModel):
    category: str = Field(max_length=64)
    code: str = Field(max_length=64)

    @field_validator("category", "code")
    @classmethod
    def normalize_value(cls, value: str) -> str:
        return value.strip().lower().replace("-", "_")

    @model_validator(mode="after")
    def validate_known_tag(self):
        category, code = validate_taxonomy_pair(self.category, self.code)
        self.category = category
        self.code = code
        return self


class ScoreUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    taxonomy_tags: list[ScoreTaxonomyTagInput] | None = None
    expected_version: int = Field(ge=1)

    @field_validator("taxonomy_tags")
    @classmethod
    def normalize_taxonomy_tags(
        cls, value: list[ScoreTaxonomyTagInput] | None
    ) -> list[ScoreTaxonomyTagInput] | None:
        if value is None:
            return None
        pairs = ordered_unique_pairs((item.category, item.code) for item in value)
        return [ScoreTaxonomyTagInput(category=category, code=code) for category, code in pairs]


class ScoreBatchDeleteRequest(BaseModel):
    score_ids: list[str] = Field(min_length=1)


class ScoreBatchArchiveRequest(BaseModel):
    score_ids: list[str] = Field(min_length=1)


class ScoreRead(BaseModel):
    score_id: str
    title: str
    taxonomy_tags: list[ScoreTaxonomyTagRead]
    state: ScoreState
    version: int
    head_revision_id: str | None
    approved_revision_id: str | None
    originating_job_id: str | None
    metadata: MetadataRead | None
    capabilities: ScoreCapabilities
    created_at: datetime
    updated_at: datetime
