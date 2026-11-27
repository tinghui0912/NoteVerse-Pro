"""Product tombstones and independently fenced Score deletion operations."""

from app.storage import object_storage as _storage_provider

from app.composition import storage_resources as _resource_wiring
from app.composition import media_resources as _media_wiring

from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
from unittest.mock import Mock
import asyncio

import pytest
from alembic import command
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.db.models import (
    Score,
    ScoreInvite,
    ScoreMembership,
    Notification,
    MailOutbox,
    ScoreDeletionOperation,
    ScoreDeletionOperationStatus as Status,
    User,
    ScoreRevisionSource,
    StorageUsageAccount,
    StoredObjectRetirement,
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.main import app
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.modules.scores.deletion_delivery import (
    ScoreDeletionDeliveryService,
    StaleScoreDeletionAttempt,
)
from app.modules.scores.deletion_executor import ScoreDeletionExecutor
from app.composition.storage_resources import storage_usage_service
from app.modules.ops.query_service import OpsAsyncOperationQueryService
from app.modules.durable_work.failure import (
    DurableFailure,
    set_failure_facts,
)
from app.shared.durable_failure import DurableFailureClass
from app.modules.ops.operation_summary import AsyncOperationSummaryQuery
from app.modules.ops.schemas import AsyncOperationKind
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.worker.dispatch import score_deletion as producer
from app.worker.execution import score_deletion as execution
from app.worker.execution import maintenance_dispatch
from app.worker.tasks import score_deletion_task
from app.shared.time import utc_now
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
    add_active_score_with_head_revision,
)
from tests.test_storage_usage import (
    storage_usage_session as storage_usage_session,
    _seed_score_with_source,
)
from tests.support.postgres_schema import postgres_schema_database


@pytest.fixture
def score_db(score_service_session):
    db, storage = score_service_session
    score = add_active_score_with_head_revision(
        db,
        score_id=500,
        revision_id=501,
        score_uuid="deletion-score",
        revision_uuid="deletion-revision",
        title="Delete me",
    )
    return db, score


def admitted(db, score):
    score.deleted_at = utc_now()
    operation = ScoreDeletionOperation(
        score_id=score.id, score_uuid=score.score_uuid, owner_user_id=score.owner_user_id
    )
    db.add(operation)
    db.commit()
    return operation


def worker_sessions(db):
    @contextmanager
    def transaction():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    return transaction


def test_admission_commits_tombstone_operation_and_attempts_immediate_dispatch(
    score_db, monkeypatch
):
    db, score = score_db
    send = Mock()
    monkeypatch.setattr(producer, "dispatch_score_deletion_best_effort", send)
    monkeypatch.setattr(
        "app.modules.scores.lifecycle_service.get_request_id", lambda: "delete-request"
    )
    monkeypatch.setattr(
        "app.modules.scores.lifecycle_service.get_async_trace_context",
        lambda: ("traceparent", "tracestate"),
    )
    ScoreLifecycleService(
        deletion_executor=_media_wiring.build_score_deletion_executor()
    ).delete_score(db, score.score_uuid, 1)
    operation = db.scalar(select(ScoreDeletionOperation))
    assert score.deleted_at is not None
    assert operation.status == Status.PENDING
    assert operation.operation_uuid != operation.score_uuid == score.score_uuid
    assert operation.score_id == score.id and operation.owner_user_id == 1
    assert operation.originating_request_id == "delete-request"
    assert operation.traceparent == "traceparent" and operation.tracestate == "tracestate"
    send.assert_called_once_with(operation.operation_uuid)


def test_admission_failure_rolls_back_tombstone_and_operation(score_db):
    db, score = score_db
    db.commit = Mock(side_effect=RuntimeError("commit failed"))
    with pytest.raises(RuntimeError, match="commit failed"):
        ScoreLifecycleService(
            deletion_executor=_media_wiring.build_score_deletion_executor()
        ).delete_score(db, score.score_uuid, 1)
    db.refresh(score)
    assert score.deleted_at is None
    assert db.scalar(select(func.count()).select_from(ScoreDeletionOperation)) == 0


@pytest.mark.asyncio
async def test_http_delete_hides_resource_before_cleanup(score_db):
    db, score = score_db
    from app.db.models.score_access import MembershipRole
    from app.modules.collaboration.invite_lifecycle import hash_invite_token
    from app.modules.guest_previews.service import GuestPreviewService

    guest_token = (
        GuestPreviewService(
            delivery=_resource_wiring.build_media_delivery_service(_storage_provider)
        )
        .issue_credential(db, score.score_uuid, 1)
        .token
    )
    invite = ScoreInvite(
        invite_uuid="pending-deletion",
        score_id=score.id,
        email="other@example.com",
        role=MembershipRole.VIEWER,
        token_hash=hash_invite_token("deletion-token"),
        created_by_user_id=1,
    )
    db.add(invite)
    db.commit()
    invite_id = invite.id
    current_user_id = 1

    def database():
        yield db

    def user():
        return db.get(User, current_user_id)

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/scores/batch-delete", json={"score_ids": ["deletion-score"]}
            )
            assert response.status_code == 200, response.text
            for path in [
                "/scores/deletion-score",
                "/scores/deletion-score/members",
                "/scores/deletion-score/invites",
                "/scores/deletion-score/revisions/deletion-revision/playback",
                "/practice/scores/deletion-score/revisions/deletion-revision/bundle",
            ]:
                result = await client.get("/api/v1" + path)
                assert result.status_code == 404, (path, result.text)
            listed = await client.get("/api/v1/library/scores")
            assert listed.status_code == 200, listed.text
            assert "deletion-score" not in str(listed.json())
            assert db.get(Score, score.id) is not None
            assert db.get(ScoreInvite, invite_id) is not None
            notification_count = db.scalar(select(func.count()).select_from(Notification))
            mail_count = db.scalar(select(func.count()).select_from(MailOutbox))
            for method, path, body in [
                (client.post, "/scores/deletion-score/invites", {"email": "other@example.com"}),
                (client.post, "/scores/deletion-score/invites/pending-deletion/revoke", None),
            ]:
                rejected = await method("/api/v1" + path, json=body)
                assert rejected.status_code == 404, rejected.text
            current_user_id = 2
            pending = await client.get("/api/v1/me/invites")
            assert pending.status_code == 200 and pending.json()["items"] == []
            inspected = await client.get("/api/v1/invites/deletion-token")
            assert inspected.status_code == 404 and "invite_not_found" in inspected.text
            for path in [
                "/invites/deletion-token/accept",
                "/me/invites/pending-deletion/accept",
                "/me/invites/pending-deletion/decline",
            ]:
                rejected = await client.post("/api/v1" + path)
                assert rejected.status_code == 404 and "invite_not_found" in rejected.text
            guest = await client.get(f"/api/v1/guest-previews/{guest_token}")
            assert guest.status_code == 404 and "guest_preview_not_found" in guest.text
            db.refresh(invite)
            assert (invite.terminal_outcome, invite.terminal_at, invite.terminal_actor_user_id) == (
                None,
                None,
                None,
            )
            assert db.scalar(select(func.count()).select_from(ScoreInvite)) == 1
            assert db.scalar(select(func.count()).select_from(ScoreMembership)) == 0
            assert db.scalar(select(func.count()).select_from(Notification)) == notification_count
            assert db.scalar(select(func.count()).select_from(MailOutbox)) == mail_count
    finally:
        app.dependency_overrides.clear()


def test_producer_publishes_operation_uuid_and_releases_broker_failure(score_db, monkeypatch):
    db, score = score_db
    operation = admitted(db, score)
    monkeypatch.setattr(producer, "SessionLocal", worker_sessions(db))
    send = Mock(side_effect=RuntimeError("broker unavailable"))
    monkeypatch.setattr("app.task_queue.producer.celery_app.send_task", send)
    assert producer.dispatch_score_deletion(operation.operation_uuid) is False
    db.refresh(operation)
    assert operation.status == Status.PENDING and operation.attempt_count == 0
    assert score.deleted_at is not None
    assert ScoreDeletionDeliveryService().recover_and_list_due(db) == [operation.operation_uuid]
    send.side_effect = None
    assert producer.dispatch_score_deletion(operation.operation_uuid) is True
    db.refresh(operation)
    assert operation.status == Status.DISPATCHED and operation.dispatched_at is not None
    assert send.call_args.kwargs["kwargs"] == {"operation_uuid": operation.operation_uuid}
    assert send.call_args.args[0] == "app.worker.tasks.score_deletion_task"


@pytest.mark.parametrize("processing", [False, True])
def test_expired_delivery_recovers_without_consuming_an_attempt(score_db, processing):
    db, score = score_db
    operation = admitted(db, score)
    service = ScoreDeletionDeliveryService()
    if processing:
        lease = service.claim(db, operation.operation_uuid)
        operation.started_at = utc_now() - timedelta(
            seconds=settings.SCORE_DELETION_PROCESSING_TIMEOUT_SECONDS + 1
        )
    else:
        service.mark_dispatched(db, operation.operation_uuid)
        operation.dispatched_at = utc_now() - timedelta(
            seconds=settings.SCORE_DELETION_DISPATCH_TIMEOUT_SECONDS + 1
        )
    attempts = operation.attempt_count
    db.commit()
    assert service.recover_and_list_due(db) == [operation.operation_uuid]
    assert operation.status == Status.FAILED and operation.attempt_count == attempts
    assert operation.attempt_token is None
    db.commit()
    current = service.claim(db, operation.operation_uuid)
    db.commit()
    assert current.attempt == attempts + 1 and current.token
    if processing:
        assert service.complete(db, lease) is False
        assert service.fail(db, lease, "stale failure") is False
        with pytest.raises(StaleScoreDeletionAttempt):
            ScoreDeletionExecutor(
                input_assets=_media_wiring.build_input_asset_lifecycle(),
                usage=_resource_wiring.storage_usage_service,
            ).execute(db, lease)
        assert operation.attempt_token == current.token
        assert service.complete(db, replace(current, token="wrong-token")) is False
        assert service.fail(db, replace(current, token="wrong-token"), "wrong token") is False


def test_failed_attempts_exhaust_and_operator_rearm_uses_lifecycle(score_db, monkeypatch):
    db, score = score_db
    operation = admitted(db, score)
    service = ScoreDeletionDeliveryService()
    for attempt in range(1, settings.SCORE_DELETION_MAX_ATTEMPTS + 1):
        operation.next_attempt_at = utc_now()
        db.commit()
        lease = service.claim(db, operation.operation_uuid)
        db.commit()
        assert lease.attempt == attempt
        failed_at = utc_now()
        with monkeypatch.context() as clock:
            clock.setattr("app.modules.scores.deletion_delivery.utc_now", lambda: failed_at)
            assert service.fail(db, lease, "object storage temporarily unavailable" + "x" * 5000)
        if attempt >= 7:
            assert operation.next_attempt_at == failed_at + timedelta(
                seconds=settings.SCORE_DELETION_RETRY_BASE_SECONDS * 64
            )
        db.commit()
        assert operation.status == Status.FAILED and len(operation.failure_detail) == 4000
        assert operation.failure_code and operation.failure_stage == "cleanup"
        assert operation.next_attempt_at > operation.started_at
    assert service.recover_and_list_due(db) == []
    assert service.mark_dispatched(db, operation.operation_uuid) is False
    assert service.claim(db, operation.operation_uuid) is None
    assert (
        OpsAsyncOperationQueryService()
        .get_operation(
            db, kind=AsyncOperationKind.SCORE_DELETION, operation_id=operation.operation_uuid
        )
        .status.value
        == "failed"
    )
    service.rearm_for_operator(db, operation.operation_uuid)
    db.commit()
    assert operation.status == Status.PENDING and operation.attempt_count == 0
    assert operation.started_at is operation.dispatched_at is operation.completed_at is None
    assert operation.failure_detail is operation.failure_code is operation.attempt_token is None
    assert service.recover_and_list_due(db) == [operation.operation_uuid]


def test_cleanup_and_completion_commit_together_and_operation_survives(score_db):
    db, score = score_db
    score_id = score.id
    operation = admitted(db, score)
    service = ScoreDeletionDeliveryService()
    lease = service.claim(db, operation.operation_uuid)
    db.commit()
    result = ScoreDeletionExecutor(
        service,
        input_assets=_media_wiring.build_input_asset_lifecycle(),
        usage=_resource_wiring.storage_usage_service,
    ).execute(db, lease)
    db.commit()
    db.expire_all()
    operation = db.scalar(select(ScoreDeletionOperation))
    assert result.scores_deleted == 1 and db.get(Score, score_id) is None
    assert operation.status == Status.COMPLETED and operation.score_id is None
    assert operation.score_uuid == "deletion-score" and operation.attempt_token is None
    timestamp = operation.completed_at
    assert service.claim(db, operation.operation_uuid) is None
    assert service.mark_dispatched(db, operation.operation_uuid) is False
    assert service.fail(db, lease, "late failure") is False
    assert service.complete(db, lease) is False
    assert operation.status == Status.COMPLETED and operation.completed_at == timestamp
    read = OpsAsyncOperationQueryService().get_operation(
        db, kind=AsyncOperationKind.SCORE_DELETION, operation_id=operation.operation_uuid
    )
    assert read.operation_id == operation.operation_uuid and read.resource_id == "deletion-score"
    assert read.status.value == "succeeded"


def test_absent_score_reconciles_to_success(score_db):
    db, score = score_db
    operation = admitted(db, score)
    score.head_revision_id = None
    db.delete(score)
    db.commit()
    db.refresh(operation)
    assert operation.score_id is None
    lease = ScoreDeletionDeliveryService().claim(db, operation.operation_uuid)
    db.commit()
    result = ScoreDeletionExecutor(
        input_assets=_media_wiring.build_input_asset_lifecycle(),
        usage=_resource_wiring.storage_usage_service,
    ).execute(db, lease)
    db.commit()
    assert result.scores_deleted == 0 and operation.status == Status.COMPLETED


def test_completion_failure_rolls_back_graph_accounting_and_retirements(
    storage_usage_session, monkeypatch
):
    db, storage = storage_usage_session
    score, revision, source = _seed_score_with_source(db, storage)
    source_id, score_id, size = source.id, score.id, source.stored_object.byte_size
    storage_usage_service.record_allocation(
        db,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=size,
        reason="seed",
        object_type="score_revision_source",
        object_id=source.source_uuid,
        storage_key=source.stored_object.object_key,
    )
    operation = admitted(db, score)
    service = ScoreDeletionDeliveryService()
    lease = service.claim(db, operation.operation_uuid)
    db.commit()
    monkeypatch.setattr(service, "complete", Mock(return_value=False))
    with pytest.raises(StaleScoreDeletionAttempt):
        ScoreDeletionExecutor(
            service,
            input_assets=_media_wiring.build_input_asset_lifecycle(),
            usage=_resource_wiring.storage_usage_service,
        ).execute(db, lease)
    db.rollback()
    assert db.get(Score, score_id).deleted_at is not None
    assert db.get(ScoreRevisionSource, source_id) is not None
    assert db.get(StorageUsageAccount, 1).used_bytes == size
    assert db.scalar(select(func.count()).select_from(StoredObjectRetirement)) == 0
    assert operation.status == Status.PROCESSING


def test_worker_runs_claim_execution_completion_and_failure_transactions(score_db, monkeypatch):
    db, score = score_db
    operation = admitted(db, score)
    monkeypatch.setattr(execution, "SessionLocal", worker_sessions(db))
    result = execution.execute_score_deletion_task(None, operation.operation_uuid)
    assert result["status"] == "completed"
    assert operation.status == Status.COMPLETED
    assert (
        execution.execute_score_deletion_task(None, operation.operation_uuid)["status"] == "ignored"
    )
    assert score_deletion_task.acks_late and score_deletion_task.reject_on_worker_lost


def test_maintenance_relays_due_operation_ids(score_db, monkeypatch):
    db, score = score_db
    operation = admitted(db, score)
    send = Mock(return_value=True)
    monkeypatch.setattr(maintenance_dispatch, "SessionLocal", worker_sessions(db))
    monkeypatch.setattr(maintenance_dispatch, "run_scheduler_scan", lambda key, scan: scan())
    monkeypatch.setattr(producer, "dispatch_score_deletion", send)
    assert maintenance_dispatch.execute_score_deletion_maintenance() == {"due": 1, "dispatched": 1}
    send.assert_called_once_with(operation.operation_uuid)


@pytest.fixture
def postgres_score(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="deletion@example.com", password_hash="hash"))
            db.flush()
            from app.composition.storage_resources import provision_storage_resources

            provision_storage_resources(db, 1)
            db.commit()
            add_active_score_with_head_revision(
                db,
                score_id=500,
                revision_id=501,
                score_uuid="deletion-score",
                revision_uuid="deletion-revision",
                title="Delete me",
            )
        yield engine


def test_postgres_operation_constraints_indexes_and_retention(postgres_score):
    engine = postgres_score
    inspector = inspect(engine)
    assert set(column["name"] for column in inspector.get_columns("scores")) == {
        "id",
        "score_uuid",
        "owner_user_id",
        "display_title",
        "genres",
        "head_revision_id",
        "created_from_import_job_id",
        "metadata_version",
        "deleted_at",
        "created_at",
        "updated_at",
    }
    indexes = {
        row["name"]: row["column_names"]
        for row in inspector.get_indexes("score_deletion_operations")
    }
    assert indexes["idx_score_deletion_due"] == ["status", "next_attempt_at"]
    assert indexes["ix_score_deletion_operations_originating_request_id"] == [
        "originating_request_id"
    ]
    with Session(engine) as db:
        operation = admitted(db, db.get(Score, 500))
        for values in [
            {"attempt_count": -1},
            {"status": Status.PROCESSING},
            {"attempt_token": "invalid"},
        ]:
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    for field, value in values.items():
                        setattr(operation, field, value)
                    db.flush()
            db.refresh(operation)
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(
                    ScoreDeletionOperation(
                        score_id=500, score_uuid="deletion-score", owner_user_id=1
                    )
                )
                db.flush()
        delivery = ScoreDeletionDeliveryService()
        lease = delivery.claim(db, operation.operation_uuid)
        db.commit()
        ScoreDeletionExecutor(
            delivery,
            input_assets=_media_wiring.build_input_asset_lifecycle(),
            usage=_resource_wiring.storage_usage_service,
        ).execute(db, lease)
        db.commit()
        db.refresh(operation)
        assert db.get(Score, 500) is None and operation.score_id is None
        assert operation.status == Status.COMPLETED and operation.score_uuid == "deletion-score"


@pytest.mark.asyncio
async def test_postgres_concurrent_admission_creates_one_operation(postgres_score, monkeypatch):
    from app.modules.scores.repository import ScoreRepository
    from app.core.exceptions import ResourceNotFoundException

    engine = create_engine(postgres_score.url)
    barrier = __import__("threading").Barrier(2)

    class ConcurrentRepository(ScoreRepository):
        def lock_active_deletion_set(self, *args, **kwargs):
            barrier.wait(10)
            return super().lock_active_deletion_set(*args, **kwargs)

    service = ScoreLifecycleService(
        repository=ConcurrentRepository(),
        deletion_executor=_media_wiring.build_score_deletion_executor(),
    )

    def delete():
        with Session(engine, expire_on_commit=False) as db:
            try:
                service.delete_score(db, "deletion-score", 1)
                return "deleted"
            except ResourceNotFoundException:
                return "not_found"

    try:
        results = await asyncio.wait_for(
            asyncio.gather(asyncio.to_thread(delete), asyncio.to_thread(delete)), 20
        )
        assert sorted(results) == ["deleted", "not_found"]
        with Session(engine) as db:
            assert db.scalar(select(func.count()).select_from(ScoreDeletionOperation)) == 1
            assert (db.get(Score, 500)).deleted_at is not None
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    "status,attempts,future,expected",
    [
        (Status.PENDING, 0, False, "queued"),
        (Status.DISPATCHED, 0, False, "dispatched"),
        (Status.PROCESSING, 1, False, "processing"),
        (Status.FAILED, 1, True, "retrying"),
        (Status.FAILED, 1, False, "failed"),
        (Status.FAILED, settings.SCORE_DELETION_MAX_ATTEMPTS, False, "failed"),
        (Status.COMPLETED, 1, False, "succeeded"),
    ],
)
def test_score_operation_list_and_summary_share_domain_failure_facts(
    score_db, status, attempts, future, expected
):
    db, score = score_db
    operation = admitted(db, score)
    operation.status, operation.attempt_count = status, attempts
    operation.attempt_token = "current" if status == Status.PROCESSING else None
    operation.next_attempt_at = utc_now() + timedelta(hours=1 if future else -1)
    if status == Status.FAILED:
        set_failure_facts(
            operation,
            DurableFailure(
                "score_deletion_execution_failed",
                "cleanup",
                DurableFailureClass.SYSTEM_ERROR,
                future,
            ),
        )
    db.commit()
    read = OpsAsyncOperationQueryService().get_operation(
        db, kind=AsyncOperationKind.SCORE_DELETION, operation_id=operation.operation_uuid
    )
    summary = AsyncOperationSummaryQuery().summary(
        db, kinds=(AsyncOperationKind.SCORE_DELETION,), filters=AsyncOperationFilters()
    )
    assert read.status.value == expected
    assert summary.total == 1
    assert [(item.status.value, item.count) for item in summary.statuses] == [(expected, 1)]
