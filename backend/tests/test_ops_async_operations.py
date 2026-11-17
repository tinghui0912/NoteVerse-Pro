from __future__ import annotations

from app.modules.import_jobs.requested_options import encode_requested_options

from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME

import os
from datetime import datetime, timedelta
from typing import cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session
from sqlmodel import SQLModel, select

from app.api.deps import get_db
from app.db.models import (
    User,
    ImportDispatch,
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    MailOutbox,
    MailOutboxStatus,
    OpsAuditEvent,
    PlaybackAssetKind,
    PlaybackOutbox,
    ScoreRevisionRenderOutbox,
    ScoreRevisionRenderStatus,
    RevisionOrigin,
    Score,
    ScoreDeletionOperation,
    ScoreDeletionOperationStatus,
    ScoreRevision,
    Operator,
    OperatorIdentity,
    OperatorIdentityProvider,
    OperatorRole,
    OperatorSession,
    PlaybackOutboxStatus,
)
from app.modules.ops.schemas import (
    AsyncOperationKind,
    AsyncOperationStatus,
)

from app.modules.ops.command_service import RETRYABLE_OPERATION_KINDS
from app.modules.ops.query_service import (
    QUERY_OPERATION_KIND_ORDER,
    OpsAsyncOperationQueryService,
    selected_query_operation_kinds,
)
from app.shared.durable_failure import DurableFailureClass
from app.shared.time import utc_now


os.environ.setdefault("CONTROL_PLANE_COOKIE_SECURE", "false")
os.environ.setdefault("CONTROL_PLANE_COOKIE_SAMESITE", "lax")
os.environ.setdefault("CONTROL_PLANE_SESSION_EXPIRE_MINUTES", "30")
os.environ.setdefault("CONTROL_PLANE_CORS_ORIGINS", '["http://testserver"]')

from app.core.control_plane_settings import (  # noqa: E402
    get_control_plane_runtime_settings,
    require_control_plane_settings,
)

get_control_plane_runtime_settings.cache_clear()

from app.control_plane_main import create_app  # noqa: E402
from app.modules.platform_operators.dependencies import OperatorPrincipal, get_current_operator  # noqa: E402
from app.modules.platform_operators.service import OperatorAuthenticationService  # noqa: E402


app = create_app()
control_settings = require_control_plane_settings()


def test_ops_query_and_retry_kind_contracts_cover_every_async_operation_kind() -> None:
    all_kinds = tuple(AsyncOperationKind)

    assert QUERY_OPERATION_KIND_ORDER == all_kinds
    assert RETRYABLE_OPERATION_KINDS == all_kinds
    assert selected_query_operation_kinds(None) == all_kinds
    for kind in all_kinds:
        assert selected_query_operation_kinds(kind) == (kind,)


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def _api_utc_datetime(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


@pytest.fixture
def ops_session(
    postgres_engine,
) -> Session:
    engine = postgres_engine
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(User(id=1, email="ops@example.test", password_hash="hash"))
        session.add(Operator(id=1, display_name="Admin"))
        session.commit()
        session.execute(text("SELECT setval(pg_get_serial_sequence('operators', 'id'), 1, true)"))
        session.commit()
        yield session


def _override_ops_dependencies(session: Session, *, authorized: bool) -> None:
    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    operator = Operator(
        id=1,
        display_name="Admin",
    )
    operator.role = (
        OperatorRole.PLATFORM_OPERATOR
        if authorized
        else cast(OperatorRole, "unsupported_test_operator_role")
    )
    principal = OperatorPrincipal(
        operator=operator,
        identity=OperatorIdentity(
            id=1,
            operator_id=1,
            provider=OperatorIdentityProvider.LOCAL_PASSWORD,
            issuer="test",
            subject="operator-test",
        ),
        session=OperatorSession(
            id=1,
            operator_id=1,
            identity_id=1,
            token_hash="test",
            expires_at=utc_now() + timedelta(hours=1),
        ),
    )
    app.dependency_overrides[get_current_operator] = lambda: principal


def test_local_operator_identity_creates_and_resolves_opaque_session(
    ops_session: Session,
) -> None:
    service = OperatorAuthenticationService()
    db = ops_session
    operator = service.create_local_operator(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        display_name="Platform Operator",
    )
    authenticated_operator, identity, token = service.authenticate_local_password(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        user_agent="test-agent",
        ip_address="198.51.100.10",
        security_settings=require_control_plane_settings(),
    )
    resolved_operator, resolved_identity, resolved_session = service.resolve_session(
        db, token=token
    )

    assert authenticated_operator.id == operator.id
    assert resolved_operator.id == operator.id
    assert resolved_identity.id == identity.id
    assert resolved_session.operator_id == operator.id
    assert resolved_session.token_hash != token


def test_operator_enums_bind_the_postgresql_values_declared_by_the_migration() -> None:
    provider_type = OperatorIdentity.__table__.c.provider.type
    role_type = Operator.__table__.c.role.type

    assert (
        provider_type.bind_processor(postgresql.dialect())(OperatorIdentityProvider.LOCAL_PASSWORD)
        == "local_password"
    )
    assert (
        role_type.bind_processor(postgresql.dialect())(OperatorRole.PLATFORM_OPERATOR)
        == "platform_operator"
    )


def test_control_plane_login_uses_an_independent_operator_session_cookie(
    client: TestClient,
    ops_session: Session,
) -> None:
    db = ops_session
    service = OperatorAuthenticationService()
    service.create_local_operator(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        display_name="Platform Operator",
    )

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        response = client.post(
            "/api/v1/auth/login",
            json={"username": "operator@example.test", "password": "a-long-operator-password"},
        )

        assert response.status_code == 204
        assert response.content == b""
        assert control_settings.auth_cookie_name in response.headers["set-cookie"]
        assert AUTH_COOKIE_NAME not in response.headers["set-cookie"]

        me_response = client.get("/api/v1/auth/me")
        assert me_response.status_code == 200
        assert me_response.json()["operator_id"]
    finally:
        _clear_ops_dependency_overrides()


def test_control_plane_logout_requires_its_own_csrf_header(
    client: TestClient,
    ops_session: Session,
) -> None:
    db = ops_session
    service = OperatorAuthenticationService()
    service.create_local_operator(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        display_name="Platform Operator",
    )

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "operator@example.test", "password": "a-long-operator-password"},
        )
        assert login.status_code == 204

        missing_csrf = client.post("/api/v1/auth/logout")
        assert missing_csrf.status_code == 403
        assert missing_csrf.json()["code"] == "csrf_token_invalid"

        csrf_token = client.cookies.get(control_settings.csrf_cookie_name)
        assert csrf_token
        logout = client.post(
            "/api/v1/auth/logout",
            headers={control_settings.csrf_header_name: csrf_token},
        )
        assert logout.status_code == 204
        assert client.get("/api/v1/auth/me").status_code == 401
    finally:
        _clear_ops_dependency_overrides()


def _clear_ops_dependency_overrides() -> None:
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_operator, None)


def _create_score_revision(
    session: Session,
    *,
    score_uuid: str = "00000000-0000-0000-0000-000000000401",
    revision_uuid: str = "00000000-0000-0000-0000-000000000501",
) -> tuple[Score, ScoreRevision]:
    score = Score(
        score_uuid=score_uuid,
        owner_user_id=1,
        display_title="Ops retry score",
    )
    session.add(score)
    session.commit()
    assert score.id is not None
    revision = ScoreRevision(
        revision_uuid=revision_uuid,
        score_id=score.id,
        revision_number=1,
        content_hash="4d79a65cfc7699044ae2a70961f04596bde500399ffd47072ad9b9e7d77a4003",
        origin=RevisionOrigin.IMPORT,
        created_by_user_id=1,
    )
    session.add(revision)
    session.commit()
    return score, revision


@pytest.mark.parametrize(
    "status,retryable,expected",
    [
        (MailOutboxStatus.PENDING, None, "queued"),
        (MailOutboxStatus.DISPATCHED, None, "dispatched"),
        (MailOutboxStatus.PROCESSING, None, "processing"),
        (MailOutboxStatus.FAILED, True, "retrying"),
        (MailOutboxStatus.FAILED, False, "failed"),
        (MailOutboxStatus.PERMANENT_FAILURE, False, "failed"),
        (MailOutboxStatus.EXPIRED, False, "failed"),
        (MailOutboxStatus.SENT, None, "succeeded"),
    ],
)
def test_ops_projects_domain_delivery_state(ops_session, status, retryable, expected):
    from app.modules.durable_work.failure import DurableFailure, set_failure_facts

    row = MailOutbox(
        category="auth",
        dedupe_key="status",
        recipient="user@example.com",
        subject="Subject",
        status=status,
        attempt_token="token" if status == MailOutboxStatus.PROCESSING else None,
    )
    if retryable is not None:
        set_failure_facts(
            row,
            DurableFailure(
                "mail_provider_transient", "delivery", DurableFailureClass.TRANSIENT, retryable
            ),
        )
    ops_session.add(row)
    ops_session.commit()
    service = OpsAsyncOperationQueryService()
    operation = service.get_operation(
        ops_session, kind=AsyncOperationKind.MAIL, operation_id=row.outbox_uuid
    )
    assert operation.status.value == expected
    summary = service.summary(ops_session, status=AsyncOperationStatus(expected))
    assert summary.total == 1


def test_ops_summary_uses_aggregated_status_counts(ops_session: Session) -> None:
    now = utc_now()
    ops_session.add_all(
        [
            MailOutbox(
                category="auth",
                dedupe_key="mail:summary:failed",
                recipient="user@example.com",
                subject="Subject",
                status=MailOutboxStatus.FAILED,
                attempt_count=1,
                next_attempt_at=now + timedelta(minutes=5),
                failure_detail="smtp temporarily unavailable",
                failure_code="mail_provider_transient",
                failure_stage="delivery",
                failure_retryable=True,
                failure_classification=DurableFailureClass.TRANSIENT.value,
            ),
            MailOutbox(
                category="auth",
                dedupe_key="mail:summary:sent",
                recipient="user2@example.com",
                subject="Subject",
                status=MailOutboxStatus.SENT,
            ),
        ]
    )
    ops_session.commit()

    service = OpsAsyncOperationQueryService()
    summary = service.summary(
        ops_session,
        kind=AsyncOperationKind.MAIL,
        failure_class=DurableFailureClass.TRANSIENT,
    )

    assert summary.total == 1
    assert summary.kinds[0].kind == AsyncOperationKind.MAIL
    assert summary.kinds[0].statuses[0].status == AsyncOperationStatus.RETRYING
    assert summary.kinds[0].statuses[0].count == 1


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/ops/audit-events"),
        ("get", "/api/v1/ops/async-operations"),
        ("get", "/api/v1/ops/async-operations/summary"),
        ("post", "/api/v1/ops/async-operations/mail/not-a-real-operation/retry"),
    ],
)
def test_ops_api_rejects_non_admin_users_without_diagnostics(
    client: TestClient,
    ops_session: Session,
    method: str,
    path: str,
) -> None:
    _override_ops_dependencies(ops_session, authorized=False)
    try:
        response = getattr(client, method)(path)
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 403
    payload = response.json()
    assert payload["code"] == "no_access"
    assert "internal_details" not in payload


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/ops/audit-events"),
        ("get", "/api/v1/ops/async-operations"),
        ("get", "/api/v1/ops/async-operations/summary"),
        ("post", "/api/v1/ops/async-operations/mail/not-a-real-operation/retry"),
    ],
)
def test_ops_api_requires_authentication_without_diagnostics(
    client: TestClient,
    method: str,
    path: str,
) -> None:
    response = getattr(client, method)(path)

    assert response.status_code == 401
    payload = response.json()
    assert payload["code"] == "token_invalid_expired"
    assert "internal_details" not in payload


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
            next_attempt_at=utc_now() + timedelta(minutes=5),
            failure_detail="smtp temporarily unavailable",
            failure_code="mail_provider_transient",
            failure_stage="delivery",
            failure_retryable=True,
            failure_classification=DurableFailureClass.TRANSIENT.value,
        )
    )
    ops_session.commit()
    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.get(
            "/api/v1/ops/async-operations/summary",
            params={"kind": "mail", "failure_class": "transient"},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["kinds"][0]["kind"] == "mail"
    assert payload["kinds"][0]["statuses"][0] == {
        "status": "retrying",
        "count": 1,
    }


def test_ops_api_async_operations_supports_offset_pagination(
    client: TestClient,
    ops_session: Session,
) -> None:
    now = utc_now()
    ops_session.add_all(
        [
            MailOutbox(
                category="auth",
                dedupe_key="mail:pagination:oldest",
                recipient="oldest@example.com",
                subject="Subject",
                status=MailOutboxStatus.FAILED,
                attempt_count=1,
                next_attempt_at=now + timedelta(minutes=10),
                failure_detail="oldest error",
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
                failure_detail="middle error",
                failure_code="mail_execution_failed",
                failure_stage="delivery",
                failure_classification=DurableFailureClass.SYSTEM_ERROR.value,
                failure_retryable=True,
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
                failure_detail="newest error",
                updated_at=now - timedelta(minutes=1),
            ),
        ]
    )
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.get(
            "/api/v1/ops/async-operations",
            params={"kind": "mail", "limit": 1, "offset": 1},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["limit"] == 1
    assert payload["offset"] == 1
    assert payload["has_more"] is True
    assert len(payload["items"]) == 1
    operation = payload["items"][0]
    assert operation["failure"] == {
        "code": "mail_execution_failed",
        "classification": "system_error",
        "detail": "middle error",
        "stage": "delivery",
        "retryable": True,
    }


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
        next_attempt_at=utc_now() + timedelta(hours=1),
        failure_detail="smtp temporarily unavailable",
        failure_code="mail_transient_failure",
        failure_stage="delivery",
        failure_classification=DurableFailureClass.TRANSIENT.value,
        failure_retryable=True,
    )
    ops_session.add(outbox)
    ops_session.commit()
    operation_id = outbox.outbox_uuid

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/mail/{operation_id}/retry",
            json={"reason": "Retry after storage access was restored."},
            headers={"X-Request-ID": "ops-retry-success"},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()
    assert data["operation_id"] == operation_id
    assert data["status"] == "queued"
    assert data["attempts"] == 0
    ops_session.refresh(outbox)
    assert outbox.status == MailOutboxStatus.PENDING
    assert outbox.attempt_count == 0
    assert outbox.failure_detail is None
    assert outbox.failure_code is None
    assert outbox.failure_stage is None
    assert outbox.failure_classification is None
    assert outbox.failure_retryable is None
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.actor_operator_id == 1
    assert audit_event.action == "retry_async_operation"
    assert audit_event.operation_kind == "mail"
    assert audit_event.operation_id == operation_id
    assert audit_event.outcome == "succeeded"
    assert audit_event.reason == "Retry after storage access was restored."
    assert audit_event.request_id == "ops-retry-success"
    assert audit_event.peer_address == "testclient"
    assert audit_event.client_address == "testclient"
    assert audit_event.previous_state == "FAILED"
    assert audit_event.new_state == "queued"

    _override_ops_dependencies(ops_session, authorized=True)
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
    assert audit_payload["limit"] == 100
    assert audit_payload["offset"] == 0
    assert audit_payload["has_more"] is False
    assert audit_payload["items"] == [
        {
            "event_id": audit_event.event_uuid,
            "actor_operator_id": 1,
            "action": "retry_async_operation",
            "operation_kind": "mail",
            "operation_id": operation_id,
            "outcome": "succeeded",
            "error_code": None,
            "reason": "Retry after storage access was restored.",
            "request_id": "ops-retry-success",
            "peer_address": "testclient",
            "client_address": "testclient",
            "previous_state": "FAILED",
            "new_state": "queued",
            "created_at": _api_utc_datetime(audit_event.created_at),
        }
    ]


def test_ops_api_audit_events_supports_offset_pagination(
    client: TestClient,
    ops_session: Session,
) -> None:
    now = utc_now()
    ops_session.add_all(
        [
            OpsAuditEvent(
                actor_operator_id=1,
                action="retry_async_operation",
                operation_kind="mail",
                operation_id="audit-oldest",
                outcome="succeeded",
                created_at=now - timedelta(minutes=3),
            ),
            OpsAuditEvent(
                actor_operator_id=1,
                action="retry_async_operation",
                operation_kind="mail",
                operation_id="audit-middle",
                outcome="succeeded",
                created_at=now - timedelta(minutes=2),
            ),
            OpsAuditEvent(
                actor_operator_id=1,
                action="retry_async_operation",
                operation_kind="mail",
                operation_id="audit-newest",
                outcome="succeeded",
                created_at=now - timedelta(minutes=1),
            ),
        ]
    )
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.get(
            "/api/v1/ops/audit-events",
            params={"limit": 1, "offset": 1, "operation_kind": "mail"},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["limit"] == 1
    assert payload["offset"] == 1
    assert payload["has_more"] is True
    assert len(payload["items"]) == 1
    assert payload["items"][0]["operation_id"] == "audit-middle"


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

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/mail/{operation_id}/retry",
            json={"reason": "Validate the completed operation state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "validation_error"
    assert "internal_details" not in payload
    ops_session.refresh(outbox)
    assert outbox.status == MailOutboxStatus.SENT
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.action == "retry_async_operation"
    assert audit_event.operation_kind == "mail"
    assert audit_event.operation_id == operation_id
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "validation_error"


def test_ops_api_retry_requires_a_bounded_reason(
    client: TestClient,
    ops_session: Session,
) -> None:
    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post("/api/v1/ops/async-operations/mail/missing/retry")
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert ops_session.scalars(select(OpsAuditEvent)).all() == []


def test_ops_api_retry_unknown_operation_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    operation_id = "missing-operation-id"

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/mail/{operation_id}/retry",
            json={"reason": "Validate the missing operation state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 404
    payload = response.json()
    assert payload["code"] == "resource_not_found"
    assert "internal_details" not in payload
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.action == "retry_async_operation"
    assert audit_event.operation_kind == "mail"
    assert audit_event.operation_id == operation_id
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "resource_not_found"


def test_ops_api_retry_rejects_confirmed_import_job_and_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    from app.db.models import Score

    score = Score(score_uuid="confirmed-retry", display_title="Score", owner_user_id=1)
    ops_session.add(score)
    ops_session.flush()
    job = ImportJob(
        requested_options=encode_requested_options(None),
        score_id=score.id,
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
        confirmed_at=utc_now(),
        job_uuid="00000000-0000-0000-0000-000000000101",
        user_id=1,
        state=ImportJobState.CONFIRMED,
    )
    ops_session.add(job)
    ops_session.flush()
    dispatch = ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED)
    ops_session.add(dispatch)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/import/{dispatch.dispatch_uuid}/retry",
            json={"reason": "Validate the confirmed import state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert "internal_details" not in payload
    ops_session.refresh(job)
    assert job.state == ImportJobState.CONFIRMED
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "import"
    assert audit_event.operation_id == dispatch.dispatch_uuid
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "validation_error"


def test_ops_api_retry_rejects_completed_render_outbox_and_records_audit(
    client: TestClient,
    ops_session: Session,
) -> None:
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
        job_uuid="00000000-0000-0000-0000-000000000102",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW,
    )
    ops_session.add(job)
    ops_session.flush()
    dispatch = ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED)
    ops_session.add(dispatch)
    ops_session.commit()
    outbox = ScoreRevisionRenderOutbox(
        outbox_uuid="00000000-0000-0000-0000-000000000202",
        **revision_render_ids(ops_session, job.user_id),
        source_fingerprint="6d01e2a02f5936672bba6dd48f3c0decf9eedf3ffca9047b258748dd0aac92ef",
        status=ScoreRevisionRenderStatus.COMPLETED,
    )
    ops_session.add(outbox)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/revision_render/{outbox.outbox_uuid}/retry",
            json={"reason": "Validate the completed render state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert "internal_details" not in payload
    ops_session.refresh(outbox)
    assert outbox.status == ScoreRevisionRenderStatus.COMPLETED
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "revision_render"
    assert audit_event.operation_id == outbox.outbox_uuid
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "validation_error"


def test_ops_api_retry_requires_deletion_operation_identity(
    client: TestClient,
    ops_session: Session,
) -> None:
    score = Score(
        score_uuid="00000000-0000-0000-0000-000000000303",
        owner_user_id=1,
        display_title="Active score",
    )
    ops_session.add(score)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/score_deletion/{score.score_uuid}/retry",
            json={"reason": "Validate the active deletion state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 404
    payload = response.json()
    assert "internal_details" not in payload
    ops_session.refresh(score)
    assert score.deleted_at is None
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "score_deletion"
    assert audit_event.operation_id == score.score_uuid
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "resource_not_found"


def test_ops_api_admin_can_retry_failed_import_job(
    client: TestClient,
    ops_session: Session,
) -> None:
    next_attempt_at = utc_now() + timedelta(hours=1)
    job = ImportJob(
        requested_options=encode_requested_options(None),
        job_uuid="00000000-0000-0000-0000-000000000111",
        user_id=1,
        state=ImportJobState.FAILED,
        progress=80,
        current_step="render",
        failure_code="import_transient_failure",
        failure_stage="dispatch",
        failure_classification=DurableFailureClass.TRANSIENT.value,
        failure_retryable=True,
        processing_started_at=utc_now() - timedelta(minutes=10),
        processing_finished_at=utc_now(),
        failure_detail="job failed",
    )
    ops_session.add(job)
    ops_session.flush()
    dispatch = ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED)
    ops_session.add(dispatch)
    ops_session.commit()

    dispatch.status = ImportDispatchStatus.FAILED
    dispatch.attempt_count = 4
    dispatch.next_attempt_at = next_attempt_at
    dispatch.failure_detail = "redis unavailable"
    ops_session.add(dispatch)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/import/{dispatch.dispatch_uuid}/retry",
            json={"reason": "Retry after import infrastructure recovery."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()
    assert data["kind"] == "import"
    assert data["operation_id"] == dispatch.dispatch_uuid
    assert data["resource_id"] == job.job_uuid
    assert data["status"] == "queued"
    ops_session.refresh(job)
    assert job.state == ImportJobState.QUEUED
    ops_session.refresh(dispatch)
    assert dispatch.status == ImportDispatchStatus.PENDING
    assert job.progress == 0
    assert job.current_step is None
    assert dispatch.attempt_count == 0
    assert dispatch.failure_detail is None
    assert job.failure_code is None
    assert job.failure_stage is None
    assert job.failure_classification is None
    assert job.failure_retryable is None
    assert job.failure_detail is None
    assert job.processing_started_at is None
    assert job.processing_finished_at is None
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "import"
    assert audit_event.operation_id == dispatch.dispatch_uuid
    assert audit_event.outcome == "succeeded"


def test_ops_api_admin_can_retry_failed_render_outbox(
    client: TestClient,
    ops_session: Session,
) -> None:
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
        job_uuid="00000000-0000-0000-0000-000000000112",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW,
    )
    ops_session.add(job)
    ops_session.flush()
    dispatch = ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED)
    ops_session.add(dispatch)
    ops_session.commit()
    outbox = ScoreRevisionRenderOutbox(
        outbox_uuid="00000000-0000-0000-0000-000000000212",
        **revision_render_ids(ops_session, job.user_id),
        source_fingerprint="8bd70392968d39fd8c94730768c9b2e2def65c4dfe9e0a675a8493143407cf2a",
        status=ScoreRevisionRenderStatus.FAILED,
        attempt_count=3,
        next_attempt_at=utc_now() + timedelta(hours=1),
        dispatched_at=utc_now() - timedelta(minutes=4),
        started_at=utc_now() - timedelta(minutes=3),
        completed_at=utc_now() - timedelta(minutes=2),
        failure_detail="renderer unavailable",
        failure_code="render_transient_failure",
        failure_stage="render",
        failure_classification=DurableFailureClass.TRANSIENT.value,
        failure_retryable=True,
    )
    ops_session.add(outbox)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/revision_render/{outbox.outbox_uuid}/retry",
            json={"reason": "Retry after rendering infrastructure recovery."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()
    assert data["kind"] == "revision_render"
    assert data["operation_id"] == outbox.outbox_uuid
    revision = ops_session.get(ScoreRevision, outbox.revision_id)
    assert data["resource_type"] == "score_revision"
    assert data["resource_id"] == revision.revision_uuid
    assert data["resource_id"] != outbox.outbox_uuid
    assert data["status"] == "queued"
    ops_session.refresh(outbox)
    assert outbox.status == ScoreRevisionRenderStatus.PENDING
    assert outbox.attempt_count == 0
    assert outbox.dispatched_at is None
    assert outbox.started_at is None
    assert outbox.completed_at is None
    assert outbox.failure_detail is None
    assert outbox.failure_code is None
    assert outbox.failure_stage is None
    assert outbox.failure_classification is None
    assert outbox.failure_retryable is None
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "revision_render"
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
        source_fingerprint="5c0008124d153564f07ff7bd63bdcdb1a4f322dc47f9a5c36a806edb9a5fafea",
        asset_kind=PlaybackAssetKind.AUDIO,
        status=PlaybackOutboxStatus.FAILED,
        attempt_count=3,
        next_attempt_at=utc_now() + timedelta(hours=1),
        dispatched_at=utc_now() - timedelta(minutes=4),
        started_at=utc_now() - timedelta(minutes=3),
        completed_at=utc_now() - timedelta(minutes=2),
        failure_detail="soundfont unavailable",
        failure_code="playback_transient_failure",
        failure_stage="playback",
        failure_classification=DurableFailureClass.TRANSIENT.value,
        failure_retryable=True,
    )
    ops_session.add(outbox)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/playback/{outbox.outbox_uuid}/retry",
            json={"reason": "Retry after playback infrastructure recovery."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()
    assert data["kind"] == "playback"
    assert data["operation_id"] == outbox.outbox_uuid
    assert data["status"] == "queued"
    ops_session.refresh(outbox)
    assert outbox.status == PlaybackOutboxStatus.PENDING
    assert outbox.attempt_count == 0
    assert outbox.dispatched_at is None
    assert outbox.started_at is None
    assert outbox.completed_at is None
    assert outbox.failure_detail is None
    assert outbox.failure_code is None
    assert outbox.failure_stage is None
    assert outbox.failure_classification is None
    assert outbox.failure_retryable is None
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "playback"
    assert audit_event.operation_id == outbox.outbox_uuid
    assert audit_event.outcome == "succeeded"


def test_ops_api_admin_can_rearm_score_deletion_operation(
    client: TestClient,
    ops_session: Session,
) -> None:
    score = Score(
        score_uuid="00000000-0000-0000-0000-000000000304",
        owner_user_id=1,
        display_title="Deleting score",
        deleted_at=utc_now(),
    )
    ops_session.add(score)
    ops_session.commit()

    operation = ScoreDeletionOperation(
        score_id=score.id,
        score_uuid=score.score_uuid,
        owner_user_id=1,
        status=ScoreDeletionOperationStatus.FAILED,
        attempt_count=5,
        next_attempt_at=utc_now() + timedelta(hours=1),
        failure_detail="object storage unavailable",
        failure_code="score_deletion_transient_failure",
        failure_stage="cleanup",
        failure_classification=DurableFailureClass.TRANSIENT.value,
        failure_retryable=True,
    )
    ops_session.add(operation)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/score_deletion/{operation.operation_uuid}/retry",
            json={"reason": "Retry after deletion cleanup infrastructure recovery."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 200
    data = response.json()
    assert data["kind"] == "score_deletion"
    assert data["operation_id"] == operation.operation_uuid
    assert data["status"] == "queued"
    ops_session.refresh(score)
    assert score.deleted_at is not None
    assert operation.attempt_count == 0
    assert operation.failure_detail is None
    assert operation.failure_code is None
    assert operation.failure_stage is None
    assert operation.failure_classification is None
    assert operation.failure_retryable is None
    audit_event = ops_session.scalars(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "score_deletion"
    assert audit_event.operation_id == operation.operation_uuid
    assert audit_event.outcome == "succeeded"


def test_filtered_pagination_reaches_matching_work_beyond_recent_batches(ops_session):
    now = utc_now()
    ops_session.add_all(
        [
            MailOutbox(
                category="auth",
                dedupe_key=f"batch-{index}",
                recipient="user@example.com",
                subject="subject",
                created_at=now,
                updated_at=now,
            )
            for index in range(5001)
        ]
    )
    target = MailOutbox(
        category="recovery",
        dedupe_key="target",
        recipient="user@example.com",
        subject="subject",
        status=MailOutboxStatus.FAILED,
        failure_code="mail_provider_transient",
        failure_stage="delivery",
        failure_classification="transient",
        failure_retryable=True,
        created_at=now - timedelta(days=2),
        updated_at=now - timedelta(days=1),
    )
    ops_session.add(target)
    ops_session.commit()
    service = OpsAsyncOperationQueryService()
    filters = dict(
        kind=AsyncOperationKind.MAIL,
        status=AsyncOperationStatus.RETRYING,
        failure_class=DurableFailureClass.TRANSIENT,
        resource_type="recovery",
        created_after=now - timedelta(days=3),
        updated_before=now - timedelta(hours=1),
    )
    page = service.list_operations(ops_session, limit=1, **filters)
    assert [item.operation_id for item in page.items] == [target.outbox_uuid]
    assert page.has_more is False
    assert service.summary(ops_session, **filters).total == 1
    page = service.list_operations(ops_session, limit=1, offset=5001)
    assert [item.operation_id for item in page.items] == [target.outbox_uuid]


@pytest.mark.parametrize(
    "model,status,kind",
    [
        (ScoreRevisionRenderOutbox, ScoreRevisionRenderStatus, AsyncOperationKind.REVISION_RENDER),
        (PlaybackOutbox, PlaybackOutboxStatus, AsyncOperationKind.PLAYBACK),
    ],
)
def test_superseded_work_is_terminal_for_queries_metrics_and_operator_rearm(
    ops_session, model, status, kind, monkeypatch
):
    from app.core.exceptions import ValidationException
    from app.modules.ops.command_service import OpsAsyncOperationCommandService
    from app.observability.async_operation_metrics import (
        _oldest_open_age_lines,
        _oldest_processing_age_lines,
        _completed_duration_average_lines,
    )

    _create_score_revision(ops_session)
    now = utc_now()
    row = model(
        outbox_uuid="superseded",
        score_id=1,
        revision_id=1,
        render_profile="default",
        source_fingerprint="hash",
        status=status.SUPERSEDED,
        created_at=now - timedelta(days=1),
        started_at=now - timedelta(seconds=100),
        completed_at=now,
        updated_at=now,
    )
    ops_session.add(row)
    ops_session.commit()
    service = OpsAsyncOperationQueryService()
    operation = service.get_operation(ops_session, kind=kind, operation_id=row.outbox_uuid)
    assert operation.status == AsyncOperationStatus.SUPERSEDED and operation.failure is None
    assert (
        service.summary(ops_session, kind=kind, status=AsyncOperationStatus.SUPERSEDED).total == 1
    )
    for metric, reader in [
        ("oldest_open_age_seconds", _oldest_open_age_lines),
        ("oldest_processing_age_seconds", _oldest_processing_age_lines),
        ("completed_duration_average_seconds", _completed_duration_average_lines),
    ]:
        assert f'noteverse_async_operation_{metric}{{kind="{kind.value}"}} 0' in reader(ops_session)
    with pytest.raises(ValidationException):
        OpsAsyncOperationCommandService().retry_operation(
            ops_session, kind=kind, operation_id=row.outbox_uuid
        )
    assert row.status == status.SUPERSEDED


def revision_render_ids(db, user_id):
    from uuid import uuid4
    from app.db.models import Score, ScoreRevision
    from app.db.models.score import RevisionOrigin

    score = Score(score_uuid=str(uuid4()), owner_user_id=user_id, display_title="Ops render")
    db.add(score)
    db.flush()
    revision = ScoreRevision(
        revision_uuid=str(uuid4()),
        score_id=score.id,
        revision_number=1,
        content_hash="a" * 64,
        origin=RevisionOrigin.EDIT,
    )
    db.add(revision)
    db.flush()
    score.head_revision_id = revision.id
    return dict(score_id=score.id, revision_id=revision.id, requested_by_user_id=user_id)
