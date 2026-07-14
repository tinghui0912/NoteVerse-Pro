from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.core.config import settings
from app.api.deps import get_current_user, get_db
from app.main import app
from app.db.models import (
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    MailOutbox,
    MailOutboxStatus,
    OpsAuditEvent,
    PlaybackAssetKind,
    PlaybackOutbox,
    RenderOutbox,
    RenderOutboxStatus,
    RenderTargetType,
    RevisionOrigin,
    Score,
    ScoreDeletionStatus,
    ScoreRevision,
    User,
    UserRole,
    PlaybackOutboxStatus,
)
from app.modules.ops.schemas import (
    AsyncOperationErrorClass,
    AsyncOperationKind,
    AsyncOperationRead,
    AsyncOperationStatus,
)
from app.modules.ops.service import AsyncOperationFilters, OpsAsyncOperationService
from app.utils.timezone import utc_now_naive


class AsyncSessionAdapter:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, instance) -> None:  # type: ignore[no-untyped-def]
        self.session.add(instance)

    async def execute(self, statement, params=None, *args, **kwargs):  # type: ignore[no-untyped-def]
        return self.session.execute(statement, params=params, *args, **kwargs)

    async def commit(self) -> None:
        self.session.commit()

    async def refresh(self, instance) -> None:  # type: ignore[no-untyped-def]
        self.session.refresh(instance)


@pytest.fixture
def ops_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _override_ops_dependencies(session: Session, *, role: UserRole) -> None:
    async def override_get_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: User(
        id=1,
        email="admin@example.com",
        display_name="Admin",
        password_hash="hash",
        role=role,
    )


def _clear_ops_dependency_overrides() -> None:
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _create_score_revision(
    session: Session,
    *,
    score_uuid: str = "00000000-0000-0000-0000-000000000401",
    revision_uuid: str = "00000000-0000-0000-0000-000000000501",
) -> tuple[Score, ScoreRevision]:
    score = Score(
        score_uuid=score_uuid,
        owner_user_id=1,
        title="Ops retry score",
    )
    session.add(score)
    session.commit()
    assert score.id is not None
    revision = ScoreRevision(
        revision_uuid=revision_uuid,
        score_id=score.id,
        revision_number=1,
        content_hash="ops-retry-content-hash",
        origin=RevisionOrigin.IMPORT,
        created_by_user_id=1,
    )
    session.add(revision)
    session.commit()
    return score, revision


def test_ops_outbox_status_normalization_distinguishes_due_failed_and_exhausted() -> None:
    service = OpsAsyncOperationService()
    now = utc_now_naive()

    retrying = service._outbox_status(
        RenderOutboxStatus.FAILED,
        attempts=1,
        max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        next_attempt_at=now,
    )
    exhausted = service._outbox_status(
        PlaybackOutboxStatus.FAILED,
        attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        next_attempt_at=now,
    )

    assert retrying == AsyncOperationStatus.FAILED
    assert exhausted == AsyncOperationStatus.EXHAUSTED


def test_ops_mail_status_normalization_preserves_permanent_failure() -> None:
    service = OpsAsyncOperationService()
    outbox = MailOutbox(
        category="auth",
        dedupe_key="mail:ops-test",
        recipient="user@example.com",
        subject="Subject",
        status=MailOutboxStatus.PERMANENT_FAILURE,
    )

    assert service._mail_status(outbox) == AsyncOperationStatus.PERMANENT_FAILED


def test_ops_error_classification_keeps_infrastructure_errors_separate() -> None:
    service = OpsAsyncOperationService()

    assert (
        service._classify_error("object storage temporarily unavailable")
        == AsyncOperationErrorClass.TRANSIENT
    )
    assert (
        service._classify_error("Render outbox references unavailable resources")
        == AsyncOperationErrorClass.PERMANENT
    )
    assert service._classify_error("unsupported MusicXML") == AsyncOperationErrorClass.USER_ERROR
    assert service._classify_error(None) is None


def test_ops_filters_match_status_error_class_resource_and_time_window() -> None:
    now = utc_now_naive()
    operation = AsyncOperationRead(
        operation_id="op-1",
        kind=AsyncOperationKind.RENDER,
        resource_type="score_revision",
        resource_id="op-1",
        status=AsyncOperationStatus.RETRYING,
        raw_status="FAILED",
        attempts=2,
        max_attempts=5,
        next_attempt_at=now + timedelta(minutes=1),
        last_error="object storage temporarily unavailable",
        error_class=AsyncOperationErrorClass.TRANSIENT,
        created_at=now - timedelta(minutes=5),
        updated_at=now,
    )

    assert OpsAsyncOperationService._matches_filters(
        operation,
        AsyncOperationFilters(
            status=AsyncOperationStatus.RETRYING,
            error_class=AsyncOperationErrorClass.TRANSIENT,
            resource_type="score_revision",
            created_after=now - timedelta(minutes=10),
            updated_before=now + timedelta(minutes=1),
        ),
    )
    assert not OpsAsyncOperationService._matches_filters(
        operation,
        AsyncOperationFilters(error_class=AsyncOperationErrorClass.PERMANENT),
    )


@pytest.mark.asyncio
async def test_ops_summary_uses_aggregated_status_counts(ops_session: Session) -> None:
    now = utc_now_naive()
    ops_session.add_all([
        MailOutbox(
            category="auth",
            dedupe_key="mail:summary:failed",
            recipient="user@example.com",
            subject="Subject",
            status=MailOutboxStatus.FAILED,
            attempt_count=1,
            next_attempt_at=now + timedelta(minutes=5),
            last_error="smtp temporarily unavailable",
        ),
        MailOutbox(
            category="auth",
            dedupe_key="mail:summary:sent",
            recipient="user2@example.com",
            subject="Subject",
            status=MailOutboxStatus.SENT,
        ),
    ])
    ops_session.commit()

    service = OpsAsyncOperationService()
    summary = await service.summary(
        AsyncSessionAdapter(ops_session),  # type: ignore[arg-type]
        kind=AsyncOperationKind.MAIL,
        error_class=AsyncOperationErrorClass.TRANSIENT,
    )

    assert summary.total == 1
    assert summary.kinds[0].kind == AsyncOperationKind.MAIL
    assert summary.kinds[0].statuses[0].status == AsyncOperationStatus.RETRYING
    assert summary.kinds[0].statuses[0].count == 1


def test_ops_api_rejects_non_admin_user(client: TestClient, ops_session: Session) -> None:
    _override_ops_dependencies(ops_session, role=UserRole.user)
    try:
        response = client.get("/api/v1/ops/async-operations")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 403
    assert response.json()["code"] == "no_access"


def test_ops_api_summary_is_available_to_admin(
    client: TestClient,
    ops_session: Session,
) -> None:
    ops_session.add(
        MailOutbox(
            category="auth",
            dedupe_key="mail:api-summary:failed",
            recipient="user@example.com",
            subject="Subject",
            status=MailOutboxStatus.FAILED,
            attempt_count=1,
            next_attempt_at=utc_now_naive() + timedelta(minutes=5),
            last_error="smtp temporarily unavailable",
        )
    )
    ops_session.commit()
    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.get(
            "/api/v1/ops/async-operations/summary",
            params={"kind": "mail", "error_class": "transient"},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["total"] == 1
    assert payload["data"]["kinds"][0]["kind"] == "mail"
    assert payload["data"]["kinds"][0]["statuses"][0] == {
        "status": "retrying",
        "count": 1,
    }


def test_ops_openapi_contract_freezes_response_shapes(client: TestClient) -> None:
    schema = client.get("/api/v1/openapi.json").json()
    paths = schema["paths"]

    assert paths["/api/v1/ops/async-operations"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/APIResponse_OffsetPage_AsyncOperationRead__"}
    assert paths["/api/v1/ops/audit-events"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/APIResponse_OffsetPage_OpsAuditEventRead__"}
    assert paths["/api/v1/ops/async-operations/{kind}/{operation_id}/retry"]["post"][
        "responses"
    ]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/APIResponse_AsyncOperationRead_"
    }

    components = schema["components"]["schemas"]
    operation_page = components["OffsetPage_AsyncOperationRead_"]["properties"]
    audit_page = components["OffsetPage_OpsAuditEventRead_"]["properties"]
    for page in (operation_page, audit_page):
        assert set(page) == {"items", "limit", "offset", "has_more"}
        assert page["limit"]["type"] == "integer"
        assert page["offset"]["type"] == "integer"
        assert page["has_more"]["type"] == "boolean"

    operation_fields = set(components["AsyncOperationRead"]["properties"])
    assert {
        "operation_id",
        "kind",
        "resource_type",
        "resource_id",
        "status",
        "raw_status",
        "attempts",
        "max_attempts",
        "next_attempt_at",
        "last_error",
        "error_class",
        "created_at",
        "updated_at",
    }.issubset(operation_fields)

    audit_fields = set(components["OpsAuditEventRead"]["properties"])
    assert {
        "event_id",
        "actor_user_id",
        "action",
        "operation_kind",
        "operation_id",
        "outcome",
        "error_code",
        "error_detail",
        "created_at",
    }.issubset(audit_fields)


def test_ops_api_async_operations_supports_offset_pagination(
    client: TestClient,
    ops_session: Session,
) -> None:
    now = utc_now_naive()
    ops_session.add_all([
        MailOutbox(
            category="auth",
            dedupe_key="mail:pagination:oldest",
            recipient="oldest@example.com",
            subject="Subject",
            status=MailOutboxStatus.FAILED,
            attempt_count=1,
            next_attempt_at=now + timedelta(minutes=10),
            last_error="oldest error",
            updated_at=now - timedelta(minutes=3),
        ),
        MailOutbox(
            category="auth",
            dedupe_key="mail:pagination:middle",
            recipient="middle@example.com",
            subject="Subject",
            status=MailOutboxStatus.FAILED,
            attempt_count=1,
            next_attempt_at=now + timedelta(minutes=10),
            last_error="middle error",
            updated_at=now - timedelta(minutes=2),
        ),
        MailOutbox(
            category="auth",
            dedupe_key="mail:pagination:newest",
            recipient="newest@example.com",
            subject="Subject",
            status=MailOutboxStatus.FAILED,
            attempt_count=1,
            next_attempt_at=now + timedelta(minutes=10),
            last_error="newest error",
            updated_at=now - timedelta(minutes=1),
        ),
    ])
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.get(
            "/api/v1/ops/async-operations",
            params={"kind": "mail", "limit": 1, "offset": 1},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["limit"] == 1
    assert payload["data"]["offset"] == 1
    assert payload["data"]["has_more"] is True
    assert len(payload["data"]["items"]) == 1
    assert payload["data"]["items"][0]["last_error"] == "middle error"


def test_ops_api_admin_can_retry_failed_mail_operation(
    client: TestClient,
    ops_session: Session,
) -> None:
    outbox = MailOutbox(
        category="auth",
        dedupe_key="mail:api-retry:failed",
        recipient="user@example.com",
        subject="Subject",
        text_body="Body",
        status=MailOutboxStatus.FAILED,
        attempt_count=3,
        next_attempt_at=utc_now_naive() + timedelta(hours=1),
        last_error="smtp temporarily unavailable",
    )
    ops_session.add(outbox)
    ops_session.commit()
    operation_id = outbox.outbox_uuid

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(f"/api/v1/ops/async-operations/mail/{operation_id}/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["operation_id"] == operation_id
    assert data["status"] == "queued"
    assert data["attempts"] == 0
    ops_session.refresh(outbox)
    assert outbox.status == MailOutboxStatus.PENDING
    assert outbox.attempt_count == 0
    assert outbox.last_error is None
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.actor_user_id == 1
    assert audit_event.action == "retry_async_operation"
    assert audit_event.operation_kind == "mail"
    assert audit_event.operation_id == operation_id
    assert audit_event.outcome == "succeeded"

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        audit_response = client.get(
            "/api/v1/ops/audit-events",
            params={
                "operation_kind": "mail",
                "operation_id": operation_id,
                "outcome": "succeeded",
            },
        )
    finally:
        _clear_ops_dependency_overrides()

    assert audit_response.status_code == 200
    audit_payload = audit_response.json()
    assert audit_payload["success"] is True
    assert audit_payload["data"]["limit"] == 100
    assert audit_payload["data"]["offset"] == 0
    assert audit_payload["data"]["has_more"] is False
    assert audit_payload["data"]["items"] == [
        {
            "event_id": audit_event.event_uuid,
            "actor_user_id": 1,
            "action": "retry_async_operation",
            "operation_kind": "mail",
            "operation_id": operation_id,
            "outcome": "succeeded",
            "error_code": None,
            "error_detail": None,
            "created_at": audit_event.created_at.isoformat(),
        }
    ]


def test_ops_api_audit_events_supports_offset_pagination(
    client: TestClient,
    ops_session: Session,
) -> None:
    now = utc_now_naive()
    ops_session.add_all([
        OpsAuditEvent(
            actor_user_id=1,
            action="retry_async_operation",
            operation_kind="mail",
            operation_id="audit-oldest",
            outcome="succeeded",
            created_at=now - timedelta(minutes=3),
        ),
        OpsAuditEvent(
            actor_user_id=1,
            action="retry_async_operation",
            operation_kind="mail",
            operation_id="audit-middle",
            outcome="succeeded",
            created_at=now - timedelta(minutes=2),
        ),
        OpsAuditEvent(
            actor_user_id=1,
            action="retry_async_operation",
            operation_kind="mail",
            operation_id="audit-newest",
            outcome="succeeded",
            created_at=now - timedelta(minutes=1),
        ),
    ])
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.get(
            "/api/v1/ops/audit-events",
            params={"limit": 1, "offset": 1, "operation_kind": "mail"},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["limit"] == 1
    assert payload["data"]["offset"] == 1
    assert payload["data"]["has_more"] is True
    assert len(payload["data"]["items"]) == 1
    assert payload["data"]["items"][0]["operation_id"] == "audit-middle"


def test_ops_api_retry_rejects_completed_mail_and_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    outbox = MailOutbox(
        category="auth",
        dedupe_key="mail:api-retry:sent",
        recipient="user@example.com",
        subject="Subject",
        text_body="Body",
        status=MailOutboxStatus.SENT,
    )
    ops_session.add(outbox)
    ops_session.commit()
    operation_id = outbox.outbox_uuid

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(f"/api/v1/ops/async-operations/mail/{operation_id}/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "validation_error"
    assert payload["details"] == {"field": "status", "status": "succeeded"}
    ops_session.refresh(outbox)
    assert outbox.status == MailOutboxStatus.SENT
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.action == "retry_async_operation"
    assert audit_event.operation_kind == "mail"
    assert audit_event.operation_id == operation_id
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "validation_error"
    assert audit_event.error_detail == '{"field": "status", "status": "succeeded"}'


def test_ops_api_retry_unknown_operation_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    operation_id = "missing-operation-id"

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(f"/api/v1/ops/async-operations/mail/{operation_id}/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 404
    payload = response.json()
    assert payload["code"] == "resource_not_found"
    assert payload["details"] == {
        "resource_type": "async_operation",
        "resource_id": operation_id,
    }
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.action == "retry_async_operation"
    assert audit_event.operation_kind == "mail"
    assert audit_event.operation_id == operation_id
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "resource_not_found"
    assert audit_event.error_detail == (
        '{"resource_id": "missing-operation-id", "resource_type": "async_operation"}'
    )


def test_ops_api_retry_rejects_confirmed_import_job_and_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    job = ImportJob(
        job_uuid="00000000-0000-0000-0000-000000000101",
        user_id=1,
        state=ImportJobState.CONFIRMED,
        dispatch_status=ImportDispatchStatus.COMPLETED,
    )
    ops_session.add(job)
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(f"/api/v1/ops/async-operations/import/{job.job_uuid}/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert payload["details"] == {"field": "status", "status": "succeeded"}
    ops_session.refresh(job)
    assert job.state == ImportJobState.CONFIRMED
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "import"
    assert audit_event.operation_id == job.job_uuid
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "validation_error"


def test_ops_api_retry_rejects_completed_render_outbox_and_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    job = ImportJob(
        job_uuid="00000000-0000-0000-0000-000000000102",
        user_id=1,
        state=ImportJobState.PENDING_REVIEW,
        dispatch_status=ImportDispatchStatus.COMPLETED,
    )
    ops_session.add(job)
    ops_session.commit()
    outbox = RenderOutbox(
        outbox_uuid="00000000-0000-0000-0000-000000000202",
        target_type=RenderTargetType.REVIEW_THUMBNAIL,
        import_job_id=job.id,
        source_fingerprint="fingerprint-render-completed",
        status=RenderOutboxStatus.COMPLETED,
    )
    ops_session.add(outbox)
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(f"/api/v1/ops/async-operations/render/{outbox.outbox_uuid}/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert payload["details"] == {"field": "status", "status": "succeeded"}
    ops_session.refresh(outbox)
    assert outbox.status == RenderOutboxStatus.COMPLETED
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "render"
    assert audit_event.operation_id == outbox.outbox_uuid
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "validation_error"


def test_ops_api_retry_rejects_active_score_deletion_and_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    score = Score(
        score_uuid="00000000-0000-0000-0000-000000000303",
        owner_user_id=1,
        title="Active score",
        deletion_status=ScoreDeletionStatus.ACTIVE,
    )
    ops_session.add(score)
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/score_deletion/{score.score_uuid}/retry"
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert payload["details"] == {"field": "status", "status": "ACTIVE"}
    ops_session.refresh(score)
    assert score.deletion_status == ScoreDeletionStatus.ACTIVE
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "score_deletion"
    assert audit_event.operation_id == score.score_uuid
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "validation_error"


def test_ops_api_admin_can_retry_failed_import_job(
    client: TestClient,
    ops_session: Session,
) -> None:
    next_dispatch_at = utc_now_naive() + timedelta(hours=1)
    job = ImportJob(
        job_uuid="00000000-0000-0000-0000-000000000111",
        user_id=1,
        state=ImportJobState.FAILURE,
        progress=80,
        current_step="render",
        dispatch_status=ImportDispatchStatus.FAILED,
        dispatch_attempt_count=4,
        publish_attempt_count=2,
        next_dispatch_at=next_dispatch_at,
        dispatch_error="redis unavailable",
        error="job failed",
        error_type="system",
        started_at=utc_now_naive() - timedelta(minutes=10),
        finished_at=utc_now_naive(),
    )
    ops_session.add(job)
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(f"/api/v1/ops/async-operations/import/{job.job_uuid}/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["kind"] == "import"
    assert data["operation_id"] == job.job_uuid
    assert data["status"] == "queued"
    ops_session.refresh(job)
    assert job.state == ImportJobState.PENDING
    assert job.dispatch_status == ImportDispatchStatus.PENDING
    assert job.progress == 0
    assert job.current_step is None
    assert job.dispatch_attempt_count == 0
    assert job.publish_attempt_count == 0
    assert job.dispatch_error is None
    assert job.error is None
    assert job.error_type is None
    assert job.started_at is None
    assert job.finished_at is None
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "import"
    assert audit_event.operation_id == job.job_uuid
    assert audit_event.outcome == "succeeded"


def test_ops_api_admin_can_retry_failed_render_outbox(
    client: TestClient,
    ops_session: Session,
) -> None:
    job = ImportJob(
        job_uuid="00000000-0000-0000-0000-000000000112",
        user_id=1,
        state=ImportJobState.PENDING_REVIEW,
        dispatch_status=ImportDispatchStatus.COMPLETED,
    )
    ops_session.add(job)
    ops_session.commit()
    outbox = RenderOutbox(
        outbox_uuid="00000000-0000-0000-0000-000000000212",
        target_type=RenderTargetType.REVIEW_THUMBNAIL,
        import_job_id=job.id,
        source_fingerprint="fingerprint-render-failed",
        status=RenderOutboxStatus.FAILED,
        attempt_count=3,
        next_attempt_at=utc_now_naive() + timedelta(hours=1),
        dispatched_at=utc_now_naive() - timedelta(minutes=4),
        started_at=utc_now_naive() - timedelta(minutes=3),
        completed_at=utc_now_naive() - timedelta(minutes=2),
        last_error="renderer unavailable",
    )
    ops_session.add(outbox)
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(f"/api/v1/ops/async-operations/render/{outbox.outbox_uuid}/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["kind"] == "render"
    assert data["operation_id"] == outbox.outbox_uuid
    assert data["status"] == "queued"
    ops_session.refresh(outbox)
    assert outbox.status == RenderOutboxStatus.PENDING
    assert outbox.attempt_count == 0
    assert outbox.dispatched_at is None
    assert outbox.started_at is None
    assert outbox.completed_at is None
    assert outbox.last_error is None
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "render"
    assert audit_event.operation_id == outbox.outbox_uuid
    assert audit_event.outcome == "succeeded"


def test_ops_api_admin_can_retry_failed_playback_outbox(
    client: TestClient,
    ops_session: Session,
) -> None:
    score, revision = _create_score_revision(
        ops_session,
        score_uuid="00000000-0000-0000-0000-000000000402",
        revision_uuid="00000000-0000-0000-0000-000000000502",
    )
    assert score.id is not None
    assert revision.id is not None
    outbox = PlaybackOutbox(
        outbox_uuid="00000000-0000-0000-0000-000000000602",
        score_id=score.id,
        revision_id=revision.id,
        source_fingerprint="fingerprint-playback-failed",
        asset_kind=PlaybackAssetKind.AUDIO,
        status=PlaybackOutboxStatus.FAILED,
        attempt_count=3,
        next_attempt_at=utc_now_naive() + timedelta(hours=1),
        dispatched_at=utc_now_naive() - timedelta(minutes=4),
        started_at=utc_now_naive() - timedelta(minutes=3),
        completed_at=utc_now_naive() - timedelta(minutes=2),
        last_error="soundfont unavailable",
    )
    ops_session.add(outbox)
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/playback/{outbox.outbox_uuid}/retry"
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["kind"] == "playback"
    assert data["operation_id"] == outbox.outbox_uuid
    assert data["status"] == "queued"
    ops_session.refresh(outbox)
    assert outbox.status == PlaybackOutboxStatus.PENDING
    assert outbox.attempt_count == 0
    assert outbox.dispatched_at is None
    assert outbox.started_at is None
    assert outbox.completed_at is None
    assert outbox.last_error is None
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "playback"
    assert audit_event.operation_id == outbox.outbox_uuid
    assert audit_event.outcome == "succeeded"


def test_ops_api_admin_can_retry_score_deletion_cleanup(
    client: TestClient,
    ops_session: Session,
) -> None:
    score = Score(
        score_uuid="00000000-0000-0000-0000-000000000304",
        owner_user_id=1,
        title="Deleting score",
        deletion_status=ScoreDeletionStatus.DELETING,
        cleanup_attempt_count=5,
        next_cleanup_at=utc_now_naive() + timedelta(hours=1),
        deletion_error="object storage unavailable",
    )
    ops_session.add(score)
    ops_session.commit()

    _override_ops_dependencies(ops_session, role=UserRole.admin)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/score_deletion/{score.score_uuid}/retry"
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["kind"] == "score_deletion"
    assert data["operation_id"] == score.score_uuid
    assert data["status"] == "queued"
    ops_session.refresh(score)
    assert score.deletion_status == ScoreDeletionStatus.DELETING
    assert score.cleanup_attempt_count == 0
    assert score.deletion_error is None
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "score_deletion"
    assert audit_event.operation_id == score.score_uuid
    assert audit_event.outcome == "succeeded"
