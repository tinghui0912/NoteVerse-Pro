"""Control Plane errors expose bounded machine facts and ingress correlation."""

from types import SimpleNamespace
import pytest
from app.core.control_plane_errors import ControlPlaneErrorCode, ControlPlaneErrorResponse
from app.core.exceptions import AppException
from app.shared.error_codes import CustomerErrorCode
from app.core.generated.control_plane_browser_protocol import (
    OPERATOR_CSRF_COOKIE_NAME,
    OPERATOR_CSRF_HEADER_NAME,
)
from app.db.models import MailOutbox, MailOutboxStatus
from app.modules.platform_operators.dependencies import get_current_operator
from app.modules.ops.router import get_ops_async_operation_query_service
from tests.support.control_plane import (
    control_app as control_app,
    control_db as control_db,
    operator_client as operator_client,
)


@pytest.mark.parametrize(
    "case,status",
    [
        ("validation", 422),
        ("authentication", 401),
        ("authorization", 403),
        ("missing", 404),
        ("retry_state", 422),
        ("csrf", 403),
        ("unhandled", 500),
    ],
)
def test_failures_share_the_typed_request_correlated_contract(
    case, status, control_app, control_db, operator_client
):
    client = operator_client
    headers = {
        "X-Request-ID": "control-error-test",
        OPERATOR_CSRF_HEADER_NAME: client.cookies.get(OPERATOR_CSRF_COOKIE_NAME),
    }
    path, method, body = "/api/v1/ops/async-operations", "get", None
    if case == "validation":
        path, method, body = "/api/v1/auth/login", "post", {"username": "x"}
    elif case == "authentication":
        client.cookies.clear()
        path = "/api/v1/auth/me"
    elif case == "authorization":
        control_app.dependency_overrides[get_current_operator] = lambda: SimpleNamespace(
            role="unadmitted-role"
        )
    elif case in {"missing", "retry_state"}:
        identity = "missing"
        if case == "retry_state":
            row = MailOutbox(
                category="auth",
                dedupe_key="complete",
                recipient="user@example.test",
                subject="Subject",
                status=MailOutboxStatus.SENT,
            )
            control_db.add(row)
            control_db.commit()
            identity = row.outbox_uuid
        path, method, body = (
            f"/api/v1/ops/async-operations/mail/{identity}/retry",
            "post",
            {"reason": "Inspect retry eligibility"},
        )
    elif case == "csrf":
        path, method = "/api/v1/auth/logout", "post"
        headers.pop(OPERATOR_CSRF_HEADER_NAME)
    else:

        def fail(*args, **kwargs):
            raise RuntimeError("private storage credential detail")

        control_app.dependency_overrides[get_ops_async_operation_query_service] = lambda: (
            SimpleNamespace(list_operations=fail)
        )
    response = client.request(method, path, headers=headers, json=body)
    assert response.status_code == status
    payload = response.json()
    assert ControlPlaneErrorResponse.model_validate(payload).model_dump() == payload
    assert set(payload) == {"code", "request_id"}
    assert (
        payload["code"]
        == {
            "validation": "validation_error",
            "authentication": "token_invalid_expired",
            "authorization": "no_access",
            "missing": "resource_not_found",
            "retry_state": "validation_error",
            "csrf": "csrf_token_invalid",
            "unhandled": "internal_error",
        }[case]
    )
    assert payload["request_id"] == response.headers["X-Request-ID"] == "control-error-test"


def test_control_plane_openapi_owns_its_error_vocabulary(control_app):
    schemas = control_app.openapi()["components"]["schemas"]
    assert all(
        isinstance(value, ControlPlaneErrorCode)
        for value in vars(control_app.state.http_error_codes).values()
    )
    assert ControlPlaneErrorResponse.model_fields["code"].annotation is ControlPlaneErrorCode
    assert schemas["ControlPlaneErrorResponse"]["properties"]["code"] == {
        "$ref": "#/components/schemas/ControlPlaneErrorCode"
    }
    assert set(schemas["ControlPlaneErrorCode"]["enum"]) == {
        code.value for code in ControlPlaneErrorCode
    }
    assert "CustomerErrorCode" not in schemas


@pytest.mark.parametrize("code", [CustomerErrorCode.REVISION_CONFLICT, "private_internal_code"])
def test_unadmitted_control_plane_failures_are_canonical_and_private(
    code, control_app, operator_client, monkeypatch
):
    failure = AppException(details={"secret": "private detail"})
    monkeypatch.setattr(failure, "code", code)

    def fail(*args, **kwargs):
        raise failure

    control_app.dependency_overrides[get_ops_async_operation_query_service] = lambda: (
        SimpleNamespace(list_operations=fail)
    )
    response = operator_client.get(
        "/api/v1/ops/async-operations", headers={"X-Request-ID": "closed-control-error"}
    )
    assert response.status_code == 400
    assert response.json() == {"code": "internal_error", "request_id": "closed-control-error"}
