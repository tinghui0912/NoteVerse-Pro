"""Import async operation projection and SQL summary share delivery/resource truth."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException
from app.db.models import ImportJob, ImportJobState, ImportDispatch, ImportDispatchStatus
from app.modules.import_jobs.dispatch_service import ImportDispatchService
from app.modules.ops.command_service import OpsAsyncOperationCommandService
from app.modules.ops.operation_projection import read_import_operation, import_operation_status_sql
from app.modules.ops.query_service import OpsAsyncOperationQueryService
from app.modules.ops.operation_summary import AsyncOperationSummaryQuery
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.schemas import (
    AsyncOperationKind,
    AsyncOperationStatus,
    AsyncOperationErrorClass,
)
from app.utils.timezone import utc_now_naive
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
    AsyncSessionAdapter,
)


CASES = [
    ("PENDING", "PENDING", 0, False, "queued", "dispatch"),
    ("RUNNING", "PENDING", 1, False, "queued", "dispatch"),
    ("PENDING", "DISPATCHED", 0, False, "dispatched", "dispatch"),
    ("RUNNING", "PROCESSING", 1, False, "processing", "dispatch"),
    ("PENDING", "FAILED", 1, True, "retrying", "dispatch"),
    ("FAILURE", "FAILED", 1, True, "failed", "job"),
    ("RUNNING", "FAILED", 1, False, "failed", "dispatch"),
    ("PENDING_REVIEW", "PROCESSING", 1, False, "succeeded", "dispatch"),
    ("CONFIRMED", "PROCESSING", 1, False, "succeeded", "dispatch"),
    ("FAILURE", "PROCESSING", 1, False, "failed", "job"),
    ("FAILURE", "PROCESSING", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "failed", "job"),
    ("FAILURE", "COMPLETED", 1, False, "failed", "job"),
    ("FAILURE", "COMPLETED", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "failed", "job"),
    ("FAILURE", "FAILED", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "exhausted", "dispatch"),
    ("RUNNING", "FAILED", settings.IMPORT_DISPATCH_MAX_ATTEMPTS, False, "exhausted", "dispatch"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("job_state,status,attempt,future,expected,owner", CASES)
async def test_import_projection_and_summary_agree(
    score_service_session, job_state, status, attempt, future, expected, owner
):
    db, _ = score_service_session
    now = utc_now_naive()
    job = ImportJob(
        job_uuid="resource",
        user_id=1,
        state=ImportJobState(job_state),
        internal_error_code="domain-error",
        internal_error_class="permanent",
        internal_error_stage="processing",
        internal_error_retryable=False,
    )
    db.add(job)
    db.flush()
    dispatch = ImportDispatch(
        job_id=job.id,
        status=ImportDispatchStatus(status),
        attempt_count=attempt,
        attempt_token="current" if status == "PROCESSING" else None,
        next_attempt_at=now + timedelta(hours=1) if future else now - timedelta(seconds=1),
        internal_error_code="delivery-error",
        internal_error_class="transient",
        internal_error_stage="dispatch",
        internal_error_retryable=True,
    )
    db.add(dispatch)
    db.commit()
    operation = read_import_operation(job, dispatch)
    assert operation.operation_id == dispatch.dispatch_uuid
    assert operation.resource_type == "import_job" and operation.resource_id == job.job_uuid
    assert operation.status == AsyncOperationStatus(expected)
    assert operation.diagnostic.code == ("domain-error" if owner == "job" else "delivery-error")
    assert operation.error_class.value == ("permanent" if owner == "job" else "transient")
    sql_status = db.scalar(
        select(import_operation_status_sql()).select_from(ImportJob).join(ImportDispatch)
    )
    assert sql_status == expected
    summary = await AsyncOperationSummaryQuery().summary(
        AsyncSessionAdapter(db),
        kinds=(AsyncOperationKind.IMPORT,),
        filters=AsyncOperationFilters(status=operation.status, error_class=operation.error_class),
    )
    assert summary.total == 1 and summary.statuses[0].status == operation.status
    excluded = await AsyncOperationSummaryQuery().summary(
        AsyncSessionAdapter(db),
        kinds=(AsyncOperationKind.IMPORT,),
        filters=AsyncOperationFilters(
            error_class=AsyncOperationErrorClass.TRANSIENT
            if owner == "job"
            else AsyncOperationErrorClass.PERMANENT
        ),
    )
    assert excluded.total == 0


@pytest.mark.asyncio
async def test_delivery_updates_drive_operation_order_and_timestamp_filters(score_service_session):
    db, _ = score_service_session
    now = utc_now_naive()
    first = ImportJob(
        job_uuid="recent-delivery",
        user_id=1,
        state=ImportJobState.PENDING,
        created_at=now - timedelta(days=3),
        updated_at=now - timedelta(days=2),
    )
    second = ImportJob(
        job_uuid="recent-job",
        user_id=1,
        state=ImportJobState.PENDING,
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
    service, adapter = OpsAsyncOperationQueryService(), AsyncSessionAdapter(db)
    before = await service._import_operations(adapter, limit=1)
    assert before[0].operation_id == d2.dispatch_uuid
    job_updated_at = first.updated_at
    assert ImportDispatchService().mark_dispatched(db, d1.dispatch_uuid)
    db.commit()
    assert first.updated_at == job_updated_at
    assert read_import_operation(first, d1).created_at == d1.created_at
    assert read_import_operation(first, d1).updated_at == d1.updated_at > job_updated_at
    assert read_import_operation(second, d2).updated_at == second.updated_at
    # Limit inside the source query must use the same combined timestamp as projection.
    ordered = await service._import_operations(adapter, limit=1)
    assert [o.operation_id for o in ordered] == [d1.dispatch_uuid]
    listed = await service.list_operations(adapter, limit=2, kind=AsyncOperationKind.IMPORT)
    assert [o.operation_id for o in listed.items] == [d1.dispatch_uuid, d2.dispatch_uuid]
    cutoff = now - timedelta(minutes=30)
    filtered = await service.list_operations(
        adapter, limit=2, kind=AsyncOperationKind.IMPORT, updated_before=cutoff
    )
    summary = await service.summary(adapter, kind=AsyncOperationKind.IMPORT, updated_before=cutoff)
    assert summary.total == len(filtered.items) == 1
    assert filtered.items[0].operation_id == d2.dispatch_uuid
    filtered = await service.list_operations(
        adapter, limit=2, kind=AsyncOperationKind.IMPORT, created_after=now - timedelta(hours=36)
    )
    summary = await service.summary(
        adapter, kind=AsyncOperationKind.IMPORT, created_after=now - timedelta(hours=36)
    )
    assert summary.total == len(filtered.items) == 1
    assert filtered.items[0].operation_id == d1.dispatch_uuid


@pytest.mark.asyncio
async def test_ops_retry_uses_dispatch_identity_only(score_service_session):
    db, _ = score_service_session
    job = ImportJob(job_uuid="domain-resource", user_id=1, state=ImportJobState.FAILURE)
    db.add(job)
    db.flush()
    dispatch = ImportDispatch(
        job_id=job.id,
        status=ImportDispatchStatus.FAILED,
        attempt_count=settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
    )
    db.add(dispatch)
    db.commit()
    service, adapter = OpsAsyncOperationCommandService(), AsyncSessionAdapter(db)
    with pytest.raises(ResourceNotFoundException):
        await service.retry_operation(
            adapter, kind=AsyncOperationKind.IMPORT, operation_id=job.job_uuid
        )
    result = await service.retry_operation(
        adapter, kind=AsyncOperationKind.IMPORT, operation_id=dispatch.dispatch_uuid
    )
    assert result.operation.operation_id == dispatch.dispatch_uuid
    assert result.operation.resource_id == job.job_uuid
    assert dispatch.status == ImportDispatchStatus.PENDING and dispatch.attempt_count == 0
