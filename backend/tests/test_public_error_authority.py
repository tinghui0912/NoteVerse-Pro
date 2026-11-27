"""Public HTTP error admission respects enum identity in both directions."""

import pytest

from app.core.control_plane_errors import (
    ControlPlaneErrorCode,
    ControlPlaneErrorResponse,
    control_plane_error_response,
)
from app.shared.error_codes import CustomerErrorCode
from app.shared.responses import ApiErrorResponse, error_response


def observe_admission(monkeypatch, model, vocabulary):
    admitted = []
    conversions = []
    dump = model.model_dump
    enum_call = type(vocabulary).__call__

    def capture(response, **kwargs):
        admitted.append(response.code)
        return dump(response, **kwargs)

    def construct(enum_type, *args, **kwargs):
        if enum_type is vocabulary:
            conversions.append(args)
        return enum_call(enum_type, *args, **kwargs)

    monkeypatch.setattr(model, "model_dump", capture)
    monkeypatch.setattr(type(vocabulary), "__call__", construct)
    return admitted, conversions


@pytest.mark.parametrize(
    "foreign",
    [
        CustomerErrorCode.VALIDATION_ERROR,
        CustomerErrorCode.RESOURCE_NOT_FOUND,
        CustomerErrorCode.NO_ACCESS,
        CustomerErrorCode.AUTH_FAILED,
        CustomerErrorCode.INTERNAL_ERROR,
    ],
)
def test_control_plane_rejects_same_valued_foreign_enum(monkeypatch, foreign):
    admitted, conversions = observe_admission(
        monkeypatch, ControlPlaneErrorResponse, ControlPlaneErrorCode
    )
    assert not isinstance(foreign, ControlPlaneErrorCode)
    assert foreign.value in {code.value for code in ControlPlaneErrorCode}
    assert control_plane_error_response(foreign, "authority-test") == {
        "code": "internal_error",
        "request_id": "authority-test",
    }
    assert len(admitted) == 1 and admitted[0] is ControlPlaneErrorCode.INTERNAL_ERROR
    assert conversions == []


@pytest.mark.parametrize("code", list(ControlPlaneErrorCode))
def test_control_plane_admits_own_enum_unchanged(monkeypatch, code):
    admitted, conversions = observe_admission(
        monkeypatch, ControlPlaneErrorResponse, ControlPlaneErrorCode
    )
    assert control_plane_error_response(code, "authority-test") == {
        "code": code.value,
        "request_id": "authority-test",
    }
    assert len(admitted) == 1 and admitted[0] is code
    assert conversions == []


@pytest.mark.parametrize(
    "foreign",
    [
        ControlPlaneErrorCode.VALIDATION_ERROR,
        ControlPlaneErrorCode.RESOURCE_NOT_FOUND,
        ControlPlaneErrorCode.NO_ACCESS,
        ControlPlaneErrorCode.AUTH_FAILED,
        ControlPlaneErrorCode.INTERNAL_ERROR,
    ],
)
def test_customer_rejects_same_valued_foreign_enum(monkeypatch, foreign):
    admitted, conversions = observe_admission(monkeypatch, ApiErrorResponse, CustomerErrorCode)
    assert not isinstance(foreign, CustomerErrorCode)
    assert error_response(foreign, "authority-test") == {
        "code": "internal_error",
        "request_id": "authority-test",
    }
    assert len(admitted) == 1 and admitted[0] is CustomerErrorCode.INTERNAL_ERROR
    assert conversions == []
