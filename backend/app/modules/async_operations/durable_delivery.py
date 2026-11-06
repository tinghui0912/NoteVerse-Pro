"""Table-free lifecycle transitions for domain-owned durable delivery records.

Callers own admission, row locks, transactions, diagnostics and worker payloads.
Every transition receives its clock and policy explicitly and performs no IO.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Generic, Protocol, TypeVar

Status = TypeVar("Status")


def _truncate_error(error: str | None) -> str | None:
    return error[:4000] if error is not None else None


class DeliveryRecord(Protocol[Status]):
    status: Status
    attempt_count: int
    next_attempt_at: datetime
    dispatched_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    last_error: str | None
    updated_at: datetime


@dataclass(frozen=True)
class DeliveryStatuses(Generic[Status]):
    pending: Status
    dispatched: Status
    processing: Status
    failed: Status
    succeeded: Status


@dataclass(frozen=True)
class DeliveryLifecyclePolicy:
    max_attempts: int
    retry_base_seconds: int
    dispatch_timeout_seconds: int
    processing_timeout_seconds: int


class ClaimAdmission(Enum):
    READY = "READY"
    INACTIVE = "INACTIVE"
    NOT_DUE = "NOT_DUE"
    EXHAUSTED = "EXHAUSTED"


@dataclass(frozen=True)
class DurableDeliveryLifecycle(Generic[Status]):
    statuses: DeliveryStatuses[Status]
    policy: DeliveryLifecyclePolicy

    def is_dispatchable(self, record: DeliveryRecord[Status], *, now: datetime) -> bool:
        return (
            record.status in (self.statuses.pending, self.statuses.failed)
            and record.next_attempt_at <= now
            and record.attempt_count < self.policy.max_attempts
        )

    def dispatch(self, record: DeliveryRecord[Status], *, now: datetime) -> bool:
        if not self.is_dispatchable(record, now=now):
            return False
        record.status = self.statuses.dispatched
        record.dispatched_at = now
        record.updated_at = now
        return True

    def release_dispatch(
        self, record: DeliveryRecord[Status], *, error: str, now: datetime
    ) -> bool:
        if record.status != self.statuses.dispatched:
            return False
        record.status = self.statuses.pending
        record.dispatched_at = None
        record.last_error = _truncate_error(error)
        record.updated_at = now
        return True

    def claim_admission(self, record: DeliveryRecord[Status], *, now: datetime) -> ClaimAdmission:
        if record.status not in (
            self.statuses.pending,
            self.statuses.failed,
            self.statuses.dispatched,
        ):
            return ClaimAdmission.INACTIVE
        # A broker-delivered PENDING/DISPATCHED command is claimable; FAILED retries
        # respect their due time. Dispatch admission independently checks all due times.
        if record.status == self.statuses.failed and record.next_attempt_at > now:
            return ClaimAdmission.NOT_DUE
        if record.attempt_count >= self.policy.max_attempts:
            return ClaimAdmission.EXHAUSTED
        return ClaimAdmission.READY

    def claim(self, record: DeliveryRecord[Status], *, now: datetime) -> bool:
        if self.claim_admission(record, now=now) is not ClaimAdmission.READY:
            return False
        record.status = self.statuses.processing
        record.attempt_count += 1
        record.started_at = now
        record.updated_at = now
        return True

    def fail(self, record: DeliveryRecord[Status], *, error: str, now: datetime) -> None:
        delay = self.policy.retry_base_seconds * (2 ** max(0, record.attempt_count - 1))
        record.status = self.statuses.failed
        record.next_attempt_at = now + timedelta(seconds=delay)
        record.last_error = _truncate_error(error)
        record.updated_at = now

    def finish(
        self, record: DeliveryRecord[Status], *, status: Status, error: str | None, now: datetime
    ) -> None:
        """Apply a caller-selected terminal outcome without interpreting its meaning."""
        record.status = status
        record.completed_at = now
        record.last_error = _truncate_error(error)
        record.updated_at = now

    def complete(self, record: DeliveryRecord[Status], *, now: datetime) -> None:
        self.finish(record, status=self.statuses.succeeded, error=None, now=now)

    @staticmethod
    def attempt_matches(record: DeliveryRecord[Status], expected_attempt: int | None) -> bool:
        return expected_attempt is None or record.attempt_count == expected_attempt

    def complete_attempt(
        self, record: DeliveryRecord[Status], *, expected_attempt: int | None, now: datetime
    ) -> bool:
        if not self.attempt_matches(record, expected_attempt):
            return False
        if record.status == self.statuses.succeeded:
            return True
        if record.status != self.statuses.processing:
            return False
        self.complete(record, now=now)
        return True

    def fail_attempt(
        self,
        record: DeliveryRecord[Status],
        *,
        expected_attempt: int | None,
        error: str,
        now: datetime,
    ) -> bool:
        if record.status != self.statuses.processing or not self.attempt_matches(
            record, expected_attempt
        ):
            return False
        self.fail(record, error=error, now=now)
        return True

    def recover_lease(self, record: DeliveryRecord[Status], *, error: str, now: datetime) -> bool:
        expired = (
            record.status == self.statuses.dispatched
            and record.dispatched_at is not None
            and record.dispatched_at
            <= now - timedelta(seconds=self.policy.dispatch_timeout_seconds)
        ) or (
            record.status == self.statuses.processing
            and record.started_at is not None
            and record.started_at <= now - timedelta(seconds=self.policy.processing_timeout_seconds)
        )
        if not expired:
            return False
        record.status = self.statuses.failed
        record.next_attempt_at = now
        record.last_error = _truncate_error(error)
        record.updated_at = now
        return True

    def reset(
        self, record: DeliveryRecord[Status], *, status: Status, reset_attempts: bool, now: datetime
    ) -> None:
        record.status = status
        if reset_attempts:
            record.attempt_count = 0
        record.next_attempt_at = now
        record.dispatched_at = None
        record.started_at = None
        record.completed_at = None
        record.last_error = None
        record.updated_at = now

    def rearm(self, record: DeliveryRecord[Status], *, now: datetime) -> None:
        self.reset(record, status=self.statuses.pending, reset_attempts=True, now=now)

    def exhaust(self, record: DeliveryRecord[Status], *, error: str, now: datetime) -> None:
        record.status = self.statuses.failed
        record.attempt_count = self.policy.max_attempts
        record.last_error = _truncate_error(error)
        record.updated_at = now
