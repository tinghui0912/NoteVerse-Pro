"""Import async operation projection and SQL summary share delivery/resource truth."""

from app.modules.import_jobs.requested_options import encode_requested_options

from datetime import timedelta
from app.shared.durable_failure import DurableFailureClass

import pytest

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException
from app.db.models import ImportJob, ImportJobState, ImportDispatch, ImportDispatchStatus
from app.modules.import_jobs.dispatch_service import ImportDispatchService
from app.modules.ops.command_service import OpsAsyncOperationCommandService
from app.modules.ops.query_service import OpsAsyncOperationQueryService
from app.modules.ops.operation_summary import AsyncOperationSummaryQuery
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.schemas import (
    AsyncOperationKind,
    AsyncOperationStatus,
)
from app.shared.time import utc_now
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
)


CASES = [
    ("QUEUED", "PENDING", 0, False, "retrying", "dispatch"),
    ("PROCESSING", "PENDING", 1, False, "retrying", "dispatch"),
    ("QUEUED", "DISPATCHED", 0, False, "dispatched", "dispatch"),
    ("PROCESSING", "PROCESSING", 1, False, "processing", "dispatch"),
    ("QUEUED", "FAILED", 1, True, "retrying", "dispatch"),
    ("FAILED", "FAILED", 1, True, "failed", "job"),
    ("PROCESSING", "FAILED", 1, False, "retrying", "dispatch"),
    ("READY_FOR_REVIEW", "PROCESSING", 1, False, "succeeded", "dispatch"),
    ("CONFIRMED", "PROCESSING", 1, False, "succeeded", "dispatch"),
    ("FAILED", "PROCESSING", 1, False, "failed", "job"),
    ("FAILED", "PROCESSING", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "failed", "job"),
    ("FAILED", "COMPLETED", 1, False, "failed", "job"),
    ("FAILED", "COMPLETED", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "failed", "job"),
    ("FAILED", "FAILED", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "failed", "job"),
    ("PROCESSING", "FAILED", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "failed", "dispatch"),
]


@pytest.mark.parametrize("job_state,status,attempt,future,expected,owner", CASES)
def test_import_projection_and_summary_agree(
    score_service_session, job_state, status, attempt, future, expected, owner
):
    db, _ = score_service_session
    now = utc_now()
    if job_state == "CONFIRMED":
        from app.db.models import Score

        db.add(Score(id=701, score_uuid="confirmed", owner_user_id=1, display_title="Confirmed"))
        db.flush()
    job = ImportJob(
        requested_options=encode_requested_options(None),
        job_uuid="resource",
        user_id=1,
        state=ImportJobState(job_state),
        processing_started_at=now
        if job_state in {"PROCESSING", "READY_FOR_REVIEW", "CONFIRMED"}
        else None,
        processing_finished_at=now
        if job_state in {"READY_FOR_REVIEW", "CONFIRMED", "FAILED"}
        else None,
        confirmed_at=now if job_state == "CONFIRMED" else None,
        score_id=701 if job_state == "CONFIRMED" else None,
        failure_code="domain-error" if job_state == "FAILED" else None,
        failure_classification="permanent" if job_state == "FAILED" else None,
        failure_stage="processing" if job_state == "FAILED" else None,
        failure_retryable=False if job_state == "FAILED" else None,
    )
    db.add(job)
    db.flush()
    dispatch = ImportDispatch(
        job_id=job.id,
        status=ImportDispatchStatus(status),
        attempt_count=attempt,
        attempt_token="current" if status == "PROCESSING" else None,
        next_attempt_at=now + timedelta(hours=1) if future else now - timedelta(seconds=1),
        failure_code="delivery-error",
        failure_classification="transient",
        failure_stage="dispatch",
        failure_retryable=attempt < settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
    )
    db.add(dispatch)
    db.commit()
    operation = OpsAsyncOperationQueryService().get_operation(
        db, kind=AsyncOperationKind.IMPORT, operation_id=dispatch.dispatch_uuid
    )
    assert operation.operation_id == dispatch.dispatch_uuid
    assert operation.resource_type == "import_job" and operation.resource_id == job.job_uuid
    assert operation.status == AsyncOperationStatus(expected)
    assert operation.failure.code == ("domain-error" if owner == "job" else "delivery-error")
    assert operation.failure.classification.value == (
        "permanent" if owner == "job" else "transient"
    )
    summary = AsyncOperationSummaryQuery().summary(
        db,
        kinds=(AsyncOperationKind.IMPORT,),
        filters=AsyncOperationFilters(
            status=operation.status, failure_class=operation.failure.classification
        ),
    )
    assert summary.total == 1 and summary.statuses[0].status == operation.status
    excluded = AsyncOperationSummaryQuery().summary(
        db,
        kinds=(AsyncOperationKind.IMPORT,),
        filters=AsyncOperationFilters(
            failure_class=DurableFailureClass.TRANSIENT
            if owner == "job"
            else DurableFailureClass.PERMANENT
        ),
    )
    assert excluded.total == 0


def test_delivery_updates_drive_operation_order_and_timestamp_filters(score_service_session):
    db, _ = score_service_session
    now = utc_now()
    first = ImportJob(
        requested_options=encode_requested_options(None),
        job_uuid="recent-delivery",
        user_id=1,
        state=ImportJobState.QUEUED,
        created_at=now - timedelta(days=3),
        updated_at=now - timedelta(days=2),
    )
    second = ImportJob(
        requested_options=encode_requested_options(None),
        job_uuid="recent-job",
        user_id=1,
        state=ImportJobState.QUEUED,
        created_at=now - timedelta(days=3),
        updated_at=now - timedelta(hours=1),
    )
    db.add_all([first, second])
    db.flush()
    d1 = ImportDispatch(
        job_id=first.id, created_at=now - timedelta(days=1), updated_at=now - timedelta(days=1)
    )
    d2 = ImportDispatch(
        job_id=second.id, created_at=now - timedelta(days=2), updated_at=now - timedelta(days=1)
    )
    db.add_all([d1, d2])
    db.commit()
    service, adapter = OpsAsyncOperationQueryService(), db
    before = service.list_operations(adapter, limit=1, kind=AsyncOperationKind.IMPORT).items
    assert before[0].operation_id == d2.dispatch_uuid
    job_updated_at = first.updated_at
    assert ImportDispatchService().mark_dispatched(db, d1.dispatch_uuid)
    db.commit()
    assert first.updated_at == job_updated_at
    assert (
        service.get_operation(
            db, kind=AsyncOperationKind.IMPORT, operation_id=d1.dispatch_uuid
        ).created_at
        == d1.created_at
    )
    assert (
        service.get_operation(
            db, kind=AsyncOperationKind.IMPORT, operation_id=d1.dispatch_uuid
        ).updated_at
        == d1.updated_at
        > job_updated_at
    )
    assert (
        service.get_operation(
            db, kind=AsyncOperationKind.IMPORT, operation_id=d2.dispatch_uuid
        ).updated_at
        == second.updated_at
    )
    # Limit inside the source query must use the same combined timestamp as projection.
    ordered = service.list_operations(adapter, limit=1, kind=AsyncOperationKind.IMPORT).items
    assert [o.operation_id for o in ordered] == [d1.dispatch_uuid]
    listed = service.list_operations(adapter, limit=2, kind=AsyncOperationKind.IMPORT)
    assert [o.operation_id for o in listed.items] == [d1.dispatch_uuid, d2.dispatch_uuid]
    cutoff = now - timedelta(minutes=30)
    filtered = service.list_operations(
        adapter, limit=2, kind=AsyncOperationKind.IMPORT, updated_before=cutoff
    )
    summary = service.summary(adapter, kind=AsyncOperationKind.IMPORT, updated_before=cutoff)
    assert summary.total == len(filtered.items) == 1
    assert filtered.items[0].operation_id == d2.dispatch_uuid
    filtered = service.list_operations(
        adapter, limit=2, kind=AsyncOperationKind.IMPORT, created_after=now - timedelta(hours=36)
    )
    summary = service.summary(
        adapter, kind=AsyncOperationKind.IMPORT, created_after=now - timedelta(hours=36)
    )
    assert summary.total == len(filtered.items) == 1
    assert filtered.items[0].operation_id == d1.dispatch_uuid


def test_ops_retry_uses_dispatch_identity_only(score_service_session):
    db, _ = score_service_session
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_finished_at=utc_now(),
        job_uuid="domain-resource",
        user_id=1,
        state=ImportJobState.FAILED,
        failure_code="import_pipeline_failed",
        failure_stage="pipeline",
        failure_classification="system_error",
        failure_retryable=False,
    )
    db.add(job)
    db.flush()
    dispatch = ImportDispatch(
        job_id=job.id,
        status=ImportDispatchStatus.FAILED,
        attempt_count=settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
    )
    db.add(dispatch)
    db.commit()
    service, adapter = OpsAsyncOperationCommandService(), db
    with pytest.raises(ResourceNotFoundException):
        service.retry_operation(adapter, kind=AsyncOperationKind.IMPORT, operation_id=job.job_uuid)
    result = service.retry_operation(
        adapter, kind=AsyncOperationKind.IMPORT, operation_id=dispatch.dispatch_uuid
    )
    assert result.operation.operation_id == dispatch.dispatch_uuid
    assert result.operation.resource_id == job.job_uuid
    assert dispatch.status == ImportDispatchStatus.PENDING and dispatch.attempt_count == 0
