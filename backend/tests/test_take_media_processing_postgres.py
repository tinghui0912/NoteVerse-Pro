"""PostgreSQL verifies Take processing retry, exhaustion and durable media readiness."""

from datetime import timedelta
from unittest.mock import patch
import pytest
from sqlalchemy import select
from app.db.models import PerformanceTake, TakeProcessingOutbox
from app.composition import media_resources as wiring
from app.modules.performance_takes.processing_states import (
    TakeProcessingStatus as Status,
    TakeMediaStatus as Media,
)
from app.shared.time import utc_now
from app.storage.base import ObjectStorageUnavailableError
from tests.test_performance_take_finalization_postgres import setup

pytest_plugins = ["tests.test_practice_bundle_postgres"]


def pending(postgres_bundle):
    sessions, reservations, finalizer, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    with sessions() as db:
        finalizer.finalize_take(db, 1, accepted.reservation_id)
        take = db.scalar(select(PerformanceTake))
        take.media_status = Media.UPLOADED
        take.recording_object.sha256 = None
        operation = TakeProcessingOutbox(take_id=take.id)
        db.add(operation)
        db.commit()
        uuid = operation.operation_uuid
    return sessions, wiring.build_take_processing_service(storage), uuid


def test_transient_verification_retries_and_commits_ready_digest(postgres_bundle):
    sessions, worker, uuid = pending(postgres_bundle)
    with patch.object(
        worker.verifier, "verify", side_effect=ObjectStorageUnavailableError("unavailable")
    ):
        assert worker.execute(uuid) == "failed"
    with sessions() as db:
        row = db.scalar(select(TakeProcessingOutbox))
        assert row.failure_retryable and row.attempt_count == 1
        row.next_attempt_at = utc_now()
        db.commit()
    assert worker.due() == [uuid]
    assert worker.execute(uuid) == "completed"
    with sessions() as db:
        take = db.scalar(select(PerformanceTake))
        assert take.media_status == Media.READY and len(take.recording_object.sha256) == 64
        assert db.scalar(select(TakeProcessingOutbox)).attempt_count == 2


def test_invalid_media_is_not_reclaimed_by_late_broker_delivery(postgres_bundle):
    sessions, worker, uuid = pending(postgres_bundle)
    with patch.object(worker.verifier, "verify", side_effect=ValueError("invalid bytes")):
        assert worker.execute(uuid) == "failed"
    with sessions() as db:
        row = db.scalar(select(TakeProcessingOutbox))
        row.next_attempt_at = utc_now()
        db.commit()
    assert worker.due() == [] and worker.execute(uuid) == "ignored"
    with sessions() as db:
        assert db.scalar(select(TakeProcessingOutbox)).attempt_count == 1
        assert db.scalar(select(PerformanceTake)).media_status == Media.FAILED


@pytest.mark.parametrize("exhausted", [False, True])
def test_expired_processing_lease_updates_readiness_and_bounds_retry(postgres_bundle, exhausted):
    sessions, worker, uuid = pending(postgres_bundle)
    with sessions() as db:
        row = db.scalar(select(TakeProcessingOutbox))
        row.status = Status.PROCESSING
        row.attempt_token = "lost-worker"
        row.attempt_count = worker.lifecycle.policy.max_attempts if exhausted else 1
        row.started_at = utc_now() - timedelta(
            seconds=worker.lifecycle.policy.processing_timeout_seconds + 1
        )
        db.scalar(select(PerformanceTake)).media_status = Media.PROCESSING
        db.commit()
    assert worker.due() == ([] if exhausted else [uuid])
    with sessions() as db:
        row = db.scalar(select(TakeProcessingOutbox))
        assert row.failure_stage == "lease" and row.failure_retryable is (not exhausted)
        assert row.status == (Status.FAILED if exhausted else Status.DISPATCHED)
        assert db.scalar(select(PerformanceTake)).media_status == Media.FAILED
    assert worker.execute(uuid) == ("ignored" if exhausted else "completed")
