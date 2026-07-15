from __future__ import annotations

from datetime import datetime
from typing import List, NotRequired, Optional, Protocol, TypedDict

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.import_job import ImportJobState
from app.modules.scores.schemas import ScoreTaxonomyTagInput


class ImportJobProcessingOptions(TypedDict, total=False):
    title: str
    taxonomy_tags: list[dict[str, str]]


class ImportJobSubmitRequestLike(Protocol):
    file_ids: List[str]
    options: Optional[ImportJobProcessingOptions]
    idempotency_key: Optional[str]


class ImportJobArtifactItem(TypedDict):
    artifact_id: NotRequired[str]
    storage_backend: str
    storage_key: str
    filename: str
    page_number: Optional[int]
    size: Optional[int]
    mime_type: Optional[str]
    sha256: Optional[str]


class ImportJobSubmitResult(TypedDict):
    job_id: str
    count: int
    state: ImportJobState


class ImportJobStatusEntry(TypedDict):
    state: ImportJobState | str
    progress: int
    public_code: Optional[str]
    public_message: Optional[str]
    score_id: Optional[str]


class ImportJobStepItem(TypedDict):
    name: str
    status: str
    start_time: Optional[str]
    end_time: Optional[str]


class ImportJobUploadItem(TypedDict):
    upload_id: Optional[str]
    sha256: str
    original_filename: Optional[str]


class ImportJobDetail(TypedDict, total=False):
    job_id: str
    score_id: Optional[str]
    state: ImportJobState | str
    progress: int
    current_step: Optional[str]
    title: Optional[str]
    taxonomy_tags: list[dict[str, str]]
    thumbnail_artifact_id: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]
    public_code: Optional[str]
    public_message: Optional[str]
    steps: List[ImportJobStepItem]
    artifacts: dict[str, List[ImportJobArtifactItem]]
    upload_ids: List[ImportJobUploadItem]


class PipelineExecutionSuccessResult(TypedDict):
    success: bool
    job_id: str


class PipelineExecutionFailureResult(TypedDict):
    success: bool
    error: str


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
            normalized_tags: list[dict[str, str]] = []
            for tag in taxonomy_tags:
                normalized = ScoreTaxonomyTagInput.model_validate(tag)
                normalized_tags.append({
                    "category": normalized.category,
                    "code": normalized.code,
                })
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
