"""Explicit failure facts supplied by the owning durable-work domain."""

from dataclasses import dataclass
from enum import StrEnum


class DurableFailureClass(StrEnum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    USER_ERROR = "user_error"
    SYSTEM_ERROR = "system_error"


@dataclass(frozen=True)
class DurableFailure:
    code: str
    stage: str
    classification: DurableFailureClass
    retryable: bool


def set_failure_metadata(record: object, failure: DurableFailure) -> None:
    setattr(record, "internal_error_code", failure.code)
    setattr(record, "internal_error_stage", failure.stage)
    setattr(record, "internal_error_class", failure.classification.value)
    setattr(record, "internal_error_retryable", failure.retryable)


def clear_failure_metadata(record: object) -> None:
    setattr(record, "internal_error_code", None)
    setattr(record, "internal_error_stage", None)
    setattr(record, "internal_error_class", None)
    setattr(record, "internal_error_retryable", None)
