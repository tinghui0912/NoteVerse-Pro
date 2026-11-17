"""Fresh ORM fields and predicates for domain-owned delivery tables.

Each factory returns an independent Field/Column. Status, targets, timestamps of
resource recency and transaction completion remain owned by the consuming domain.
"""

from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, Text
from sqlmodel import Field

from app.modules.durable_work.failure import DurableFailureClass
from app.shared.time import utc_now


def delivery_attempt_count_field(*, sql_default: bool = True) -> Any:
    return Field(
        default=0, sa_column=Column(Integer, nullable=False, default=0 if sql_default else None)
    )


def delivery_attempt_token_field() -> Any:
    return Field(default=None, sa_column=Column(String(36)))


def delivery_next_attempt_at_field(*, sql_default: bool = True) -> Any:
    return Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True), nullable=False, default=utc_now if sql_default else None
        ),
    )


def delivery_optional_timestamp_field() -> Any:
    return Field(default=None, sa_column=Column(DateTime(timezone=True)))


def failure_detail_field() -> Any:
    return Field(default=None, sa_column=Column(Text))


def failure_code_field() -> Any:
    return Field(default=None, sa_column=Column(String(128)))


def failure_stage_field() -> Any:
    return Field(default=None, sa_column=Column(String(64)))


def failure_classification_field() -> Any:
    return Field(default=None, sa_column=Column(String(32)))


def failure_retryable_field() -> Any:
    return Field(default=None, sa_column=Column(Boolean))


def delivery_attempt_count_constraint(*, name: str) -> CheckConstraint:
    return CheckConstraint("attempt_count >= 0", name=name)


def delivery_attempt_token_constraint(*, name: str, processing_status: str) -> CheckConstraint:
    status = "'" + processing_status.replace("'", "''") + "'"
    return CheckConstraint(
        f"(status = {status} AND attempt_token IS NOT NULL) OR (status <> {status} AND attempt_token IS NULL)",
        name=name,
    )


def durable_failure_facts_constraint(*, name: str) -> CheckConstraint:
    classifications = ", ".join(
        "'" + value.value.replace("'", "''") + "'" for value in DurableFailureClass
    )
    return CheckConstraint(
        "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR "
        "(failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL "
        f"AND failure_classification IN ({classifications})))",
        name=name,
    )
