from __future__ import annotations

from datetime import datetime, timedelta
from typing import cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.core.config import settings
from app.api.deps import get_db
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
    Operator,
    OperatorIdentity,
    OperatorIdentityProvider,
    OperatorRole,
    OperatorSession,
    PlaybackOutboxStatus,
)
from app.modules.ops.schemas import (
    AsyncOperationErrorClass,
    AsyncOperationKind,
    AsyncOperationRead,
    AsyncOperationStatus,
)
from app.modules.ops.service import AsyncOperationFilters, OpsAsyncOperationService
from app.modules.async_operations.diagnostics import (
    AsyncOperationErrorClassValue,
    classify_async_error,
)
from app.utils.timezone import utc_now_naive


settings.CONTROL_PLANE_AUTH_COOKIE_NAME = "noteverse_control_auth"
settings.CONTROL_PLANE_CSRF_COOKIE_NAME = "noteverse_control_csrf"
settings.CONTROL_PLANE_CSRF_HEADER_NAME = "x-control-csrf-token"
settings.CONTROL_PLANE_COOKIE_SECURE = False
settings.CONTROL_PLANE_COOKIE_SAMESITE = "lax"
settings.CONTROL_PLANE_SESSION_EXPIRE_MINUTES = 30
settings.CONTROL_PLANE_CORS_ORIGINS = ["http://testserver"]

from app.control_plane_main import create_app  # noqa: E402
from app.core.control_plane_settings import require_control_plane_settings  # noqa: E402
from app.modules.platform_operators.dependencies import OperatorPrincipal, get_current_operator  # noqa: E402
from app.modules.platform_operators.service import OperatorAuthenticationService  # noqa: E402


app = create_app()


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def _api_utc_datetime(value: datetime) -> str:
    return f"{value.isoformat()}Z"


class AsyncSessionAdapter:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, instance) -> None:
        self.session.add(instance)

    async def execute(self, statement, params=None, *args, **kwargs):
        return self.session.execute(statement, params=params, *args, **kwargs)

    async def commit(self) -> None:
        self.session.commit()

    async def flush(self) -> None:
        self.session.flush()

    async def get(self, entity, identifier):
        return self.session.get(entity, identifier)

    async def refresh(self, instance) -> None:
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


def _override_ops_dependencies(session: Session, *, authorized: bool) -> None:
    async def override_get_db():
        yield AsyncSessionAdapter(session)

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
    app.dependency_overrides[get_current_operator] = lambda: OperatorPrincipal(
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
            expires_at=utc_now_naive() + timedelta(hours=1),
        ),
    )


@pytest.mark.asyncio
async def test_local_operator_identity_creates_and_resolves_opaque_session(ops_session: Session) -> None:
    service = OperatorAuthenticationService()
    db = AsyncSessionAdapter(ops_session)
    operator = await service.create_local_operator(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        display_name="Platform Operator",
    )
    authenticated_operator, identity, token = await service.authenticate_local_password(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        user_agent="test-agent",
        ip_address="198.51.100.10",
        security_settings=require_control_plane_settings(),
    )
    resolved_operator, resolved_identity, resolved_session = await service.resolve_session(db, token=token)

    assert authenticated_operator.id == operator.id
    assert resolved_operator.id == operator.id
    assert resolved_identity.id == identity.id
    assert resolved_session.operator_id == operator.id
    assert resolved_session.token_hash != token


@pytest.mark.asyncio
async def test_control_plane_login_uses_an_independent_operator_session_cookie(
    client: TestClient,
    ops_session: Session,
) -> None:
    db = AsyncSessionAdapter(ops_session)
    service = OperatorAuthenticationService()
    await service.create_local_operator(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        display_name="Platform Operator",
    )

    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        response = client.post(
            "/api/v1/auth/login",
            json={"username": "operator@example.test", "password": "a-long-operator-password"},
        )

        assert response.status_code == 200
        assert settings.CONTROL_PLANE_AUTH_COOKIE_NAME in response.headers["set-cookie"]
        assert settings.AUTH_COOKIE_NAME not in response.headers["set-cookie"]

        me_response = client.get("/api/v1/auth/me")
        assert me_response.status_code == 200
        assert me_response.json()["operator_id"]
    finally:
        _clear_ops_dependency_overrides()


@pytest.mark.asyncio
async def test_control_plane_logout_requires_its_own_csrf_header(
    client: TestClient,
    ops_session: Session,
) -> None:
    db = AsyncSessionAdapter(ops_session)
    service = OperatorAuthenticationService()
    await service.create_local_operator(
        db,
        username="operator@example.test",
        password="a-long-operator-password",
        display_name="Platform Operator",
    )

    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "operator@example.test", "password": "a-long-operator-password"},
        )
        assert login.status_code == 200

        missing_csrf = client.post("/api/v1/auth/logout")
        assert missing_csrf.status_code == 403
        assert missing_csrf.json()["public_code"] == "csrf_token_invalid"

        csrf_token = client.cookies.get(settings.CONTROL_PLANE_CSRF_COOKIE_NAME)
        assert csrf_token
        logout = client.post(
            "/api/v1/auth/logout",
            headers={settings.CONTROL_PLANE_CSRF_HEADER_NAME: csrf_token},
        )
        assert logout.status_code == 200
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
    assert (
        classify_async_error("object storage temporarily unavailable")
        == AsyncOperationErrorClassValue.TRANSIENT
    )
    assert (
        classify_async_error("Render outbox references unavailable resources")
        == AsyncOperationErrorClassValue.PERMANENT
    )
    assert classify_async_error("unsupported MusicXML") == AsyncOperationErrorClassValue.USER_ERROR
    assert classify_async_error(None) is None


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
            internal_error_class=AsyncOperationErrorClass.TRANSIENT.value,
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
        AsyncSessionAdapter(ops_session),
        kind=AsyncOperationKind.MAIL,
        error_class=AsyncOperationErrorClass.TRANSIENT,
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
    assert payload["public_code"] == "no_access"
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
    assert payload["public_code"] == "token_invalid_expired"
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
            next_attempt_at=utc_now_naive() + timedelta(minutes=5),
            last_error="smtp temporarily unavailable",
            internal_error_class=AsyncOperationErrorClass.TRANSIENT.value,
        )
    )
    ops_session.commit()
    _override_ops_dependencies(ops_session, authorized=True)
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
        "error_class",
        "diagnostic",
        "created_at",
        "updated_at",
    }.issubset(operation_fields)

    audit_fields = set(components["OpsAuditEventRead"]["properties"])
    assert {
        "event_id",
        "actor_operator_id",
        "action",
        "operation_kind",
        "operation_id",
        "outcome",
        "error_code",
        "reason",
        "request_id",
        "peer_address",
        "client_address",
        "previous_state",
        "new_state",
        "created_at",
    }.issubset(audit_fields)
    assert "reason" in components["RetryAsyncOperationCommand"]["required"]


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
            internal_error_code="mail_unknown_failure",
            internal_error_stage="delivery",
            internal_error_class=AsyncOperationErrorClass.UNKNOWN.value,
            internal_error_retryable=True,
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
    assert payload["success"] is True
    assert payload["data"]["limit"] == 1
    assert payload["data"]["offset"] == 1
    assert payload["data"]["has_more"] is True
    assert len(payload["data"]["items"]) == 1
    operation = payload["data"]["items"][0]
    assert operation["error_class"] == "unknown"
    assert operation["diagnostic"] == {
        "code": "mail_unknown_failure",
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
        next_attempt_at=utc_now_naive() + timedelta(hours=1),
        last_error="smtp temporarily unavailable",
        internal_error_code="mail_transient_failure",
        internal_error_stage="delivery",
        internal_error_class=AsyncOperationErrorClass.TRANSIENT.value,
        internal_error_retryable=True,
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
    data = response.json()["data"]
    assert data["operation_id"] == operation_id
    assert data["status"] == "queued"
    assert data["attempts"] == 0
    ops_session.refresh(outbox)
    assert outbox.status == MailOutboxStatus.PENDING
    assert outbox.attempt_count == 0
    assert outbox.last_error is None
    assert outbox.internal_error_code is None
    assert outbox.internal_error_stage is None
    assert outbox.internal_error_class is None
    assert outbox.internal_error_retryable is None
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
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
    assert audit_event.new_state == "PENDING"

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
    assert audit_payload["success"] is True
    assert audit_payload["data"]["limit"] == 100
    assert audit_payload["data"]["offset"] == 0
    assert audit_payload["data"]["has_more"] is False
    assert audit_payload["data"]["items"] == [
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
            "new_state": "PENDING",
            "created_at": _api_utc_datetime(audit_event.created_at),
        }
    ]


def test_ops_api_audit_events_supports_offset_pagination(
    client: TestClient,
    ops_session: Session,
) -> None:
    now = utc_now_naive()
    ops_session.add_all([
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
    ])
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
    assert payload["public_code"] == "validation_error"
    assert "internal_details" not in payload
    ops_session.refresh(outbox)
    assert outbox.status == MailOutboxStatus.SENT
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
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
    assert response.json()["public_code"] == "validation_error"
    assert ops_session.exec(select(OpsAuditEvent)).all() == []


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
    assert payload["public_code"] == "resource_not_found"
    assert "internal_details" not in payload
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.action == "retry_async_operation"
    assert audit_event.operation_kind == "mail"
    assert audit_event.operation_id == operation_id
    assert audit_event.outcome == "failed"
    assert audit_event.error_code == "resource_not_found"


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

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/import/{job.job_uuid}/retry",
            json={"reason": "Validate the confirmed import state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert "internal_details" not in payload
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

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/render/{outbox.outbox_uuid}/retry",
            json={"reason": "Validate the completed render state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert "internal_details" not in payload
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

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/score_deletion/{score.score_uuid}/retry",
            json={"reason": "Validate the active deletion state."},
        )
    finally:
        _clear_ops_dependency_overrides()

    assert response.status_code == 422
    payload = response.json()
    assert "internal_details" not in payload
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
        internal_error_code="import_transient_failure",
        internal_error_stage="dispatch",
        internal_error_class=AsyncOperationErrorClass.TRANSIENT.value,
        internal_error_retryable=True,
        error="job failed",
        error_type="system",
        started_at=utc_now_naive() - timedelta(minutes=10),
        finished_at=utc_now_naive(),
    )
    ops_session.add(job)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/import/{job.job_uuid}/retry",
            json={"reason": "Retry after import infrastructure recovery."},
        )
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
    assert job.internal_error_code is None
    assert job.internal_error_stage is None
    assert job.internal_error_class is None
    assert job.internal_error_retryable is None
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
        internal_error_code="render_transient_failure",
        internal_error_stage="render",
        internal_error_class=AsyncOperationErrorClass.TRANSIENT.value,
        internal_error_retryable=True,
    )
    ops_session.add(outbox)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/render/{outbox.outbox_uuid}/retry",
            json={"reason": "Retry after rendering infrastructure recovery."},
        )
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
    assert outbox.internal_error_code is None
    assert outbox.internal_error_stage is None
    assert outbox.internal_error_class is None
    assert outbox.internal_error_retryable is None
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
        internal_error_code="playback_transient_failure",
        internal_error_stage="playback",
        internal_error_class=AsyncOperationErrorClass.TRANSIENT.value,
        internal_error_retryable=True,
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
    assert outbox.internal_error_code is None
    assert outbox.internal_error_stage is None
    assert outbox.internal_error_class is None
    assert outbox.internal_error_retryable is None
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
        internal_error_code="score_deletion_transient_failure",
        internal_error_stage="cleanup",
        internal_error_class=AsyncOperationErrorClass.TRANSIENT.value,
        internal_error_retryable=True,
    )
    ops_session.add(score)
    ops_session.commit()

    _override_ops_dependencies(ops_session, authorized=True)
    try:
        response = client.post(
            f"/api/v1/ops/async-operations/score_deletion/{score.score_uuid}/retry",
            json={"reason": "Retry after deletion cleanup infrastructure recovery."},
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
    assert score.internal_error_code is None
    assert score.internal_error_stage is None
    assert score.internal_error_class is None
    assert score.internal_error_retryable is None
    audit_event = ops_session.exec(select(OpsAuditEvent)).one()
    assert audit_event.operation_kind == "score_deletion"
    assert audit_event.operation_id == score.score_uuid
    assert audit_event.outcome == "succeeded"
