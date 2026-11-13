"""Runtime and consumer projections share the application failure schema."""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException
from pydantic import TypeAdapter, ValidationError

from app.api.deps import get_db
from app.api.runtime_schemas import ReadinessUnavailableRead
from app.core.exceptions import (
    AppException,
    AuthenticationException,
    ConflictException,
    ExternalServiceException,
    ResourceAlreadyExistsException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.main import app
from app.modules.guest_previews.dependencies import get_guest_preview_service
from app.shared.constants import ErrorCode
from app.shared.responses import ApiErrorResponse


def pydantic_failure():
    try:
        ApiErrorResponse.model_validate({"code": []})
    except ValidationError as exc:
        return exc
    raise AssertionError("Expected validation error")


@pytest.mark.parametrize(
    "exception,status,code",
    [
        (
            AppException(code="business_rule_violation", details={"secret": "private"}),
            400,
            "business_rule_violation",
        ),
        (AuthenticationException(details={"secret": "private"}), 401, ErrorCode.AUTH_FAILED),
        (UnauthorizedException(details={"secret": "private"}), 403, ErrorCode.UNAUTHORIZED),
        (
            ResourceNotFoundException("private-resource", "internal-id"),
            404,
            ErrorCode.RESOURCE_NOT_FOUND,
        ),
        (
            ConflictException("revision_conflict", details={"secret": "private"}),
            409,
            "revision_conflict",
        ),
        (
            ResourceAlreadyExistsException("private-resource"),
            409,
            ErrorCode.RESOURCE_ALREADY_EXISTS,
        ),
        (
            ValidationException(field="secret", details={"secret": "private"}),
            422,
            ErrorCode.VALIDATION_ERROR,
        ),
        (pydantic_failure(), 422, ErrorCode.VALIDATION_ERROR),
        (
            ExternalServiceException("private-service"),
            503,
            ErrorCode.FEATURE_TEMPORARILY_UNAVAILABLE,
        ),
        (RuntimeError("private exception details"), 500, ErrorCode.INTERNAL_ERROR),
        (HTTPException(400, detail={"secret": "private"}), 400, ErrorCode.VALIDATION_ERROR),
    ],
)
def test_application_failure_runtime_matches_openapi(exception, status, code):
    async def fake_db() -> AsyncGenerator[object, None]:
        yield object()

    service = type("Service", (), {"audio": AsyncMock(side_effect=exception)})()
    app.dependency_overrides[get_db] = fake_db
    app.dependency_overrides[get_guest_preview_service] = lambda: service
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                "/api/v1/guest-previews/token/playback", headers={"X-Request-ID": "error-contract"}
            )
            spec = client.get("/api/v1/openapi.json").json()
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_guest_preview_service, None)
    assert response.status_code == status
    expected = ApiErrorResponse(code=code, request_id="error-contract")
    assert ApiErrorResponse.model_validate(response.json()) == expected
    assert response.json() == expected.model_dump(mode="json")
    assert response.headers["X-Request-ID"] == response.json()["request_id"]
    operation = spec["paths"]["/api/v1/guest-previews/{token}/playback"]["get"]
    schema = operation["responses"][str(status) if status == 422 else "default"]["content"][
        "application/json"
    ]["schema"]
    assert schema == {"$ref": "#/components/schemas/ApiErrorResponse"}


def test_request_validation_matches_the_same_wire_model(client):
    response = client.post("/api/v1/auth/login", headers={"X-Request-ID": "request-validation"})
    assert response.status_code == 422
    assert response.json() == ApiErrorResponse(
        code=ErrorCode.VALIDATION_ERROR, request_id="request-validation"
    ).model_dump(mode="json")
    assert response.headers["X-Request-ID"] == response.json()["request_id"]


def test_customer_application_operations_declare_canonical_errors(client):
    spec = client.get("/api/v1/openapi.json").json()
    for path, methods in spec["paths"].items():
        if not path.startswith("/api/v1/"):
            continue
        for method, operation in methods.items():
            if method not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                continue
            for status in ("default", "422"):
                assert operation["responses"][status]["content"]["application/json"]["schema"] == {
                    "$ref": "#/components/schemas/ApiErrorResponse"
                }, (path, method, status)
    schema = spec["components"]["schemas"]["ApiErrorResponse"]
    assert set(schema["properties"]) == {"code", "request_id"}
    assert set(schema["required"]) == {"code", "request_id"}
    assert schema["properties"]["code"]["type"] == "string"
    assert schema["properties"]["request_id"]["type"] == "string"
    assert schema["properties"]["request_id"]["minLength"] == 1


@pytest.mark.parametrize("failure", ["database", "storage"])
def test_readiness_failure_uses_process_schema(client, monkeypatch, failure):
    monkeypatch.setattr(
        "app.api.health.check_database_readiness", AsyncMock(return_value=failure != "database")
    )
    monkeypatch.setattr(
        "app.api.health.check_storage_quota_policy_readiness",
        AsyncMock(return_value=failure != "storage"),
    )
    monkeypatch.setattr("app.api.health.check_redis_readiness", AsyncMock(return_value=True))
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert TypeAdapter(ReadinessUnavailableRead).validate_python(response.json()) == response.json()
    assert response.json()["status"] == "not_ready"
    spec = client.get("/api/v1/openapi.json").json()
    assert spec["paths"]["/health/ready"]["get"]["responses"]["503"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/ReadinessUnavailableRead"}


def test_framework_resource_errors_use_customer_wire_contract(client):
    response = client.get(
        "/api/v1/scores/missing/unknown-resource", headers={"X-Request-ID": "framework-error"}
    )
    assert response.status_code == 404
    assert response.json() == ApiErrorResponse(
        code=ErrorCode.RESOURCE_NOT_FOUND, request_id="framework-error"
    ).model_dump(mode="json")
