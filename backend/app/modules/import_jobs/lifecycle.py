"""Import aggregate transition effects inside the caller-owned transaction."""

from datetime import datetime

from app.db.models import ImportJob
from app.modules.import_jobs.domain import ImportJobState
from app.modules.durable_work.failure import DurableFailure, clear_failure_facts, set_failure_facts
from app.shared.time import require_utc

IMPORT_EXECUTION_CLOSED_STATES = frozenset(
    {
        ImportJobState.READY_FOR_REVIEW,
        ImportJobState.CONFIRMED,
        ImportJobState.FAILED,
    }
)


def queue_import(job: ImportJob, *, now: datetime) -> None:
    if job.id is not None:
        raise ValueError("Import admission requires a new aggregate")
    job.created_at = require_utc(now)
    _queued(job, now=now)


def _queued(job: ImportJob, *, now: datetime) -> None:
    job.state = ImportJobState.QUEUED
    job.progress = 0
    job.current_step = None
    job.processing_started_at = None
    job.processing_last_heartbeat_at = None
    job.processing_finished_at = None
    job.confirmed_at = None
    clear_failure_facts(job)
    job.updated_at = require_utc(now)


def reset_processing(job: ImportJob, *, now: datetime) -> None:
    if job.state not in {ImportJobState.QUEUED, ImportJobState.PROCESSING, ImportJobState.FAILED}:
        raise ValueError("Closed processing outcomes cannot be recovered")
    _queued(job, now=now)


def begin_processing(job: ImportJob, *, now: datetime) -> None:
    if job.state == ImportJobState.PROCESSING:
        return
    if job.state != ImportJobState.QUEUED:
        raise ValueError("Only a queued Import can begin processing")
    job.state = ImportJobState.PROCESSING
    job.processing_started_at = require_utc(now)
    job.updated_at = require_utc(now)


def record_processing_heartbeat(job: ImportJob, *, now: datetime) -> None:
    if job.state != ImportJobState.PROCESSING:
        raise ValueError("Only active processing records heartbeats")
    job.processing_last_heartbeat_at = require_utc(now)
    job.updated_at = require_utc(now)


def mark_ready_for_review(job: ImportJob, *, now: datetime) -> None:
    if job.state != ImportJobState.PROCESSING:
        raise ValueError("Review admission requires active processing")
    job.state = ImportJobState.READY_FOR_REVIEW
    job.progress = 100
    job.processing_finished_at = require_utc(now)
    clear_failure_facts(job)
    job.updated_at = require_utc(now)


def mark_failed(
    job: ImportJob, *, failure: DurableFailure, detail: str | None, now: datetime
) -> None:
    if job.state not in {ImportJobState.QUEUED, ImportJobState.PROCESSING}:
        raise ValueError("Failure admission requires open processing")
    job.state = ImportJobState.FAILED
    job.progress = 0
    job.processing_finished_at = require_utc(now)
    job.confirmed_at = None
    set_failure_facts(job, failure, detail=detail)
    job.updated_at = require_utc(now)


def mark_confirmed(job: ImportJob, *, now: datetime) -> None:
    if job.state == ImportJobState.CONFIRMED:
        return
    if job.state != ImportJobState.READY_FOR_REVIEW:
        raise ValueError("Score confirmation requires an Import ready for review")
    job.state = ImportJobState.CONFIRMED
    job.confirmed_at = require_utc(now)
    clear_failure_facts(job)
    job.updated_at = require_utc(now)
