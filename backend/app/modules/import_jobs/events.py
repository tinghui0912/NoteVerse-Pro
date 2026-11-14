"""Committed Import business facts; browser and notification types are projections."""

from typing import ClassVar
from pydantic import Field, field_validator

from app.modules.domain_events.definitions import DomainFact
from app.modules.import_jobs.public_errors import PUBLIC_IMPORT_JOB_ERROR_CODES


class ImportJobCompleted(DomainFact):
    event_type: ClassVar[str] = "import.job.completed"
    schema_version: ClassVar[int] = 1
    aggregate_type: ClassVar[str] = "import_job"

    job_id: str = Field(min_length=1, max_length=128)
    recipient_user_id: int = Field(gt=0)
    requested_title: str | None = None

    @property
    def aggregate_id(self) -> str:
        return self.job_id

    @property
    def dedupe_key(self) -> str:
        return f"{self.event_type}:{self.job_id}"


class ImportJobFailed(DomainFact):
    event_type: ClassVar[str] = "import.job.failed"
    schema_version: ClassVar[int] = 1
    aggregate_type: ClassVar[str] = "import_job"

    job_id: str = Field(min_length=1, max_length=128)
    recipient_user_id: int = Field(gt=0)
    public_failure_code: str | None = None

    @field_validator("public_failure_code")
    @classmethod
    def public_failure_semantics(cls, value: str | None) -> str | None:
        if value is not None and value not in PUBLIC_IMPORT_JOB_ERROR_CODES:
            raise ValueError("Import failure fact requires a public failure code")
        return value

    @property
    def aggregate_id(self) -> str:
        return self.job_id

    @property
    def dedupe_key(self) -> str:
        return f"{self.event_type}:{self.job_id}"
