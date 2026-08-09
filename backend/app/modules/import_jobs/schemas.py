from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Protocol, TypedDict

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.import_job import ImportJobState
from app.modules.scores.schemas import ScoreTaxonomyTagInput


class ImportJobProcessingOptions(TypedDict, total=False):
    title: str
    taxonomy_tags: list[ScoreTaxonomyTagInput]


class ImportJobSubmitRequestLike(Protocol):
    @property
    def file_ids(self) -> List[str]: ...

    @property
    def options(self) -> Optional[ImportJobProcessingOptions]: ...

    @property
    def idempotency_key(self) -> Optional[str]: ...


class ImportJobSubmitResult(TypedDict):
    job_id: str
    count: int
    state: ImportJobState


class ImportArtifactRead(BaseModel):
    artifact_id: str
    filename: str
    page_number: int | None = None
    size: int | None = None
    mime_type: str | None = None
    upload_id: str | None = None
    original_filename: str | None = None


class ImportJobRead(BaseModel):
    job_id: str
    state: ImportJobState
    progress: int
    score_id: str | None = None
    title: str | None = None
    taxonomy_tags: list[ScoreTaxonomyTagInput] = []
    thumbnail: ImportArtifactRead | None = None
    created_at: str | None = None
    updated_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    public_code: str | None = None
    public_message: str | None = None
    original_images: list[ImportArtifactRead] = []


class ImportJobSubmitRead(BaseModel):
    job_id: str
    count: int
    state: ImportJobState


class ImportJobStatusRead(BaseModel):
    state: ImportJobState
    progress: int
    public_code: str | None = None
    public_message: str | None = None
    score_id: str | None = None


class ImportJobBatchStatusRead(BaseModel):
    jobs: dict[str, ImportJobStatusRead]


class ImportJobStatusEntry(TypedDict):
    state: ImportJobState | str
    progress: int
    public_code: Optional[str]
    public_message: Optional[str]
    score_id: Optional[str]


class ImportJobOriginalImageItem(TypedDict):
    artifact_id: str
    filename: str
    page_number: Optional[int]
    size: Optional[int]
    mime_type: Optional[str]
    upload_id: Optional[str]
    original_filename: Optional[str]


class ImportJobThumbnailItem(TypedDict):
    artifact_id: str
    filename: str
    page_number: Optional[int]
    size: Optional[int]
    mime_type: Optional[str]


class ImportJobDetail(TypedDict, total=False):
    job_id: str
    score_id: Optional[str]
    state: ImportJobState | str
    progress: int
    title: Optional[str]
    taxonomy_tags: list[dict[str, str]]
    thumbnail: Optional[ImportJobThumbnailItem]
    created_at: Optional[str]
    updated_at: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]
    public_code: Optional[str]
    public_message: Optional[str]
    original_images: List[ImportJobOriginalImageItem]


class PipelineExecutionSuccessResult(TypedDict):
    success: bool
    job_id: str


class ImportJobSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_ids: List[str] = Field(..., min_length=1)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=128)
    options: Optional[ImportJobProcessingOptions] = None

    @field_validator("options")
    @classmethod
    def validate_options(
        cls, value: Optional[ImportJobProcessingOptions]
    ) -> Optional[ImportJobProcessingOptions]:
        if value is None:
            return None
        taxonomy_tags = value.get("taxonomy_tags")
        if taxonomy_tags is not None:
            normalized_tags: list[ScoreTaxonomyTagInput] = []
            for tag in taxonomy_tags:
                normalized = ScoreTaxonomyTagInput.model_validate(tag)
                normalized_tags.append(normalized)
            value["taxonomy_tags"] = normalized_tags
        return value

    @field_validator("idempotency_key")
    @classmethod
    def normalize_idempotency_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None


class BatchImportJobStatusRequest(BaseModel):
    job_ids: List[str] = Field(..., min_length=1)


class ImportJobStatusUpdate(TypedDict, total=False):
    current_step: Optional[str]
    error: Optional[str]
    error_type: Optional[str]
    code: Optional[str]
    started_at: Optional[datetime]
