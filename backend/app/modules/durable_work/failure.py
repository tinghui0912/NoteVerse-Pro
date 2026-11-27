"""Explicit failure facts supplied by the owning durable-work domain."""

from dataclasses import dataclass
from typing import Protocol

import app.shared.durable_failure as failure_taxonomy


@dataclass(frozen=True)
class DurableFailure:
    code: str
    stage: str
    classification: failure_taxonomy.DurableFailureClass
    retryable: bool


class FailureDetailRecord(Protocol):
    failure_detail: str | None


class FailureFactsRecord(FailureDetailRecord, Protocol):
    failure_code: str | None
    failure_stage: str | None
    failure_classification: str | None
    failure_retryable: bool | None


def bounded_failure_detail(detail: str | None) -> str | None:
    return detail[:4000] if detail is not None else None


def set_failure_facts(
    record: FailureFactsRecord, failure: DurableFailure, *, detail: str | None = None
) -> None:
    record.failure_code = failure.code
    record.failure_stage = failure.stage
    record.failure_classification = failure.classification.value
    record.failure_retryable = failure.retryable
    record.failure_detail = bounded_failure_detail(detail)


def clear_failure_facts(record: FailureFactsRecord) -> None:
    record.failure_code = None
    record.failure_stage = None
    record.failure_classification = None
    record.failure_retryable = None
    record.failure_detail = None
