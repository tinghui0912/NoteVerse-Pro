"""Ops retry explicitly admits known owner failures at its application boundary."""

from app.modules.ops.query_service import OpsAsyncOperationQueryService
from app.platform.config.delivery import OpsDeliveryConfig
from app.runtime.control_plane.context import get_context


from unittest.mock import Mock

import pytest
from sqlalchemy import select

from app.core.control_plane_errors import ControlPlaneErrorCode
from app.core.exceptions import AppException, ResourceNotFoundException, ValidationException
from app.db.models import OpsAuditEvent
from tests.support.runtime_resources import deliveries
from app.modules.ops.command_service import OpsAsyncOperationCommandService
from app.modules.ops.schemas import AsyncOperationKind
from app.core.generated.control_plane_browser_protocol import (
    OPERATOR_CSRF_HEADER_NAME,
    OPERATOR_CSRF_COOKIE_NAME,
)
from app.shared.error_codes import CustomerErrorCode
from tests.support.control_plane import (
    control_app as control_app,
    control_db as control_db,
    operator_client as operator_client,
)

OWNERS = [
    (AsyncOperationKind.IMPORT, deliveries().imports),
    (AsyncOperationKind.REVISION_RENDER, deliveries().render),
    (AsyncOperationKind.PLAYBACK, deliveries().playback),
    (AsyncOperationKind.MAIL, deliveries().mail),
    (AsyncOperationKind.SCORE_DELETION, deliveries().score_deletion),
]
FAILURES = [
    (ResourceNotFoundException, ControlPlaneErrorCode.RESOURCE_NOT_FOUND, 404),
    (ValidationException, ControlPlaneErrorCode.VALIDATION_ERROR, 422),
]


def owner_failure(exception_type):
    if exception_type is ResourceNotFoundException:
        return ResourceNotFoundException("domain_delivery", "private-identity")
    return ValidationException(details={"status": "ineligible"})


@pytest.mark.parametrize("kind,owner", OWNERS)
@pytest.mark.parametrize("exception_type,code,status", FAILURES)
def test_retry_command_translates_known_owner_failures(
    monkeypatch, kind, owner, exception_type, code, status
):
    original = owner_failure(exception_type)
    assert isinstance(original.code, CustomerErrorCode)
    rearm = Mock(side_effect=original)
    monkeypatch.setattr(owner, "rearm_for_operator", rearm)
    db = Mock()
    with pytest.raises(exception_type) as caught:
        OpsAsyncOperationCommandService(
            {kind: owner.rearm_for_operator for kind, owner in OWNERS}, query=Mock()
        ).retry_operation(db, kind=kind, operation_id="operation")
    assert caught.value.code is code
    assert caught.value.status_code == status
    assert caught.value.__cause__ is original
    if exception_type is ValidationException:
        assert caught.value.details == original.details
    rearm.assert_called_once_with(db, "operation")
    db.commit.assert_not_called()


@pytest.mark.parametrize("kind,owner", OWNERS)
@pytest.mark.parametrize("exception_type,code,status", FAILURES)
def test_retry_http_and_audit_use_admitted_operator_code(
    monkeypatch, kind, owner, exception_type, code, status, control_db, operator_client
):
    monkeypatch.setitem(
        operator_client.app.state.ops_commands.owners,
        kind,
        Mock(side_effect=owner_failure(exception_type)),
    )
    response = operator_client.post(
        f"/api/v1/ops/async-operations/{kind.value}/operation/retry",
        json={"reason": "Inspect current retry eligibility"},
        headers={OPERATOR_CSRF_HEADER_NAME: operator_client.cookies.get(OPERATOR_CSRF_COOKIE_NAME)},
    )
    assert response.status_code == status
    assert response.json()["code"] == code.value
    event = control_db.scalars(
        select(OpsAuditEvent).where(OpsAuditEvent.action == "retry_async_operation")
    ).one()
    assert event.outcome == "failed"
    assert type(event.error_code) is str and event.error_code == code.value


@pytest.mark.parametrize("kind,owner", OWNERS)
def test_retry_command_does_not_translate_unexpected_domain_failure(monkeypatch, kind, owner):
    original = AppException(code=CustomerErrorCode.NO_ACCESS, details={"private": "diagnostic"})
    monkeypatch.setattr(owner, "rearm_for_operator", Mock(side_effect=original))
    db = Mock()
    with pytest.raises(AppException) as caught:
        OpsAsyncOperationCommandService(
            {kind: owner.rearm_for_operator for kind, owner in OWNERS}, query=Mock()
        ).retry_operation(db, kind=kind, operation_id="operation")
    assert caught.value is original
    assert caught.value.code is CustomerErrorCode.NO_ACCESS
    db.commit.assert_not_called()


def test_unexpected_domain_code_is_private_in_http_and_audit(
    monkeypatch, control_db, operator_client
):
    monkeypatch.setitem(
        operator_client.app.state.ops_commands.owners,
        AsyncOperationKind.MAIL,
        Mock(
            side_effect=AppException(
                code=CustomerErrorCode.NO_ACCESS, details={"private": "diagnostic"}
            )
        ),
    )
    response = operator_client.post(
        "/api/v1/ops/async-operations/mail/operation/retry",
        json={"reason": "Inspect current retry eligibility"},
        headers={OPERATOR_CSRF_HEADER_NAME: operator_client.cookies.get(OPERATOR_CSRF_COOKIE_NAME)},
    )
    assert response.status_code == 400
    assert set(response.json()) == {"code", "request_id"}
    assert response.json()["code"] == "internal_error"
    event = control_db.scalars(
        select(OpsAuditEvent).where(OpsAuditEvent.action == "retry_async_operation")
    ).one()
    assert type(event.error_code) is str and event.error_code == "internal_error"


@pytest.mark.parametrize("kind", list(AsyncOperationKind))
def test_missing_operation_query_retains_control_plane_authority(kind, control_db):
    with pytest.raises(ResourceNotFoundException) as caught:
        OpsAsyncOperationQueryService(
            config=OpsDeliveryConfig.model_validate(get_context().settings.model_dump())
        ).get_operation(control_db, kind=kind, operation_id="missing-operation")
    assert caught.value.code is ControlPlaneErrorCode.RESOURCE_NOT_FOUND
    assert caught.value.status_code == 404
