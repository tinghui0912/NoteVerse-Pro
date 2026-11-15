"""Direct operator representations, cookie lifecycle and UTC wire timestamps."""

from datetime import datetime
import re
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.core.generated.control_plane_browser_protocol import (
    OPERATOR_AUTH_COOKIE_NAME,
    OPERATOR_CSRF_COOKIE_NAME,
    OPERATOR_CSRF_HEADER_NAME,
)
from app.db.models import MailOutbox, MailOutboxStatus, OperatorSession
from app.modules.platform_operators.schemas import OperatorRead
from app.modules.ops.schemas import (
    AsyncOperationRead,
    AsyncOperationsSummaryRead,
    OpsAuditEventRead,
)
from app.shared.pagination import OffsetPage
from tests.support.control_plane import (
    control_app as control_app,
    control_db as control_db,
    operator_client as operator_client,
)


def test_login_and_logout_are_bodyless_cookie_transitions(operator_client, control_db):
    client = operator_client
    assert client.cookies.get(OPERATOR_AUTH_COOKIE_NAME)
    csrf = client.cookies.get(OPERATOR_CSRF_COOKIE_NAME)
    assert csrf
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert OperatorRead.model_validate(response.json()).model_dump(mode="json") == response.json()
    response = client.post("/api/v1/auth/logout", headers={OPERATOR_CSRF_HEADER_NAME: csrf})
    assert response.status_code == 204 and response.content == b""
    assert not client.cookies.get(OPERATOR_AUTH_COOKIE_NAME) and not client.cookies.get(
        OPERATOR_CSRF_COOKIE_NAME
    )
    assert control_db.scalar(select(OperatorSession)).revoked_at is not None
    assert client.get("/api/v1/auth/me").status_code == 401
    for cookie in response.headers.get_list("set-cookie"):
        assert "Max-Age=0" in cookie and "Path=/" in cookie and "SameSite=lax" in cookie


def test_ops_representations_are_direct_and_utc_in_nested_pages(operator_client, control_db):
    timestamp = datetime(2026, 11, 15, 12, 34, 56)
    row = MailOutbox(
        category="auth",
        dedupe_key="contract",
        recipient="user@example.test",
        subject="Subject",
        text_body="Body",
        status=MailOutboxStatus.FAILED,
        internal_error_code="mail_provider_transient",
        internal_error_stage="delivery",
        internal_error_class="transient",
        internal_error_retryable=True,
        created_at=timestamp,
        updated_at=timestamp,
    )
    control_db.add(row)
    control_db.commit()
    response = operator_client.get("/api/v1/ops/async-operations")
    assert response.status_code == 200
    page = response.json()
    assert OffsetPage[AsyncOperationRead].model_validate(page).model_dump(mode="json") == page
    assert (
        page["items"][0]["created_at"]
        == page["items"][0]["updated_at"]
        == "2026-11-15T12:34:56.000000Z"
    )
    response = operator_client.get("/api/v1/ops/async-operations/summary")
    assert (
        AsyncOperationsSummaryRead.model_validate(response.json()).model_dump(mode="json")
        == response.json()
    )
    csrf = operator_client.cookies.get(OPERATOR_CSRF_COOKIE_NAME)
    response = operator_client.post(
        f"/api/v1/ops/async-operations/mail/{row.outbox_uuid}/retry",
        json={"reason": "Provider recovered"},
        headers={OPERATOR_CSRF_HEADER_NAME: csrf},
    )
    assert response.status_code == 200
    assert (
        AsyncOperationRead.model_validate(response.json()).model_dump(mode="json")
        == response.json()
    )
    assert response.json()["status"] == "queued"
    response = operator_client.get("/api/v1/ops/audit-events")
    audit = response.json()
    assert OffsetPage[OpsAuditEventRead].model_validate(audit).model_dump(mode="json") == audit
    assert len(audit["items"]) == 1
    assert re.fullmatch(r".*\.\d{6}Z", audit["items"][0]["created_at"])


def test_operator_and_customer_credentials_have_distinct_audiences(operator_client, control_app):
    from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME
    from app.main import create_app

    with TestClient(control_app) as client:
        client.cookies.set(AUTH_COOKIE_NAME, "customer-credential")
        assert client.get("/api/v1/auth/me").status_code == 401
        assert client.get("/api/v1/scores").status_code == 404
    with TestClient(create_app()) as customer:
        customer.cookies.set(
            OPERATOR_AUTH_COOKIE_NAME, operator_client.cookies.get(OPERATOR_AUTH_COOKIE_NAME)
        )
        assert customer.get("/api/v1/me/profile").status_code == 401
