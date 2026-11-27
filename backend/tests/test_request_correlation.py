"""HTTP ingress owns one correlation identity across errors, logs and response headers."""

import asyncio
import json

import httpx
import pytest
from fastapi import Request
from tests.support.browser import BrowserTestClient as TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.exceptions import HTTPException

from app.core.exceptions import AppException
from app.shared.error_codes import CustomerErrorCode
from app.core.control_plane_errors import ControlPlaneErrorCode
from app.core.logger import json_format, logger
from app.core.middleware import LoggingMiddleware
from app.shared.request_id import REQUEST_ID_PATTERN
from app.platform.correlation import get_request_id
from app.core.request_correlation import request_correlation_id
from app.runtime.customer_api.main import create_app
from app.core.generated.customer_browser_protocol import (
    CUSTOMER_API_PREFIX,
    AUTH_COOKIE_NAME,
)


@pytest.fixture
def runtime():
    app = create_app()
    logs = []
    observations = []

    def capture(message):
        if message.record["extra"].get("event", "").startswith(("http.", "api.request")):
            logs.append((get_request_id(), json.loads(json_format(message.record))))

    sink = logger.add(capture)

    class IngressProbe(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            observations.append((request_correlation_id(request), get_request_id()))
            return await call_next(request)

    # Added after CORS/Origin/logging to observe the outermost user middleware.
    app.add_middleware(IngressProbe)

    @app.get(f"{CUSTOMER_API_PREFIX}/correlation/fail/{{kind}}")
    async def fail(kind: str):
        if kind == "unhandled":
            raise RuntimeError("private failure")
        if kind == "framework":
            raise HTTPException(404, detail="private")
        raise AppException(code=CustomerErrorCode.VALIDATION_ERROR, status_code=int(kind))

    @app.get(f"{CUSTOMER_API_PREFIX}/correlation/validate")
    async def validate(count: int):
        return {"count": count}

    @app.post(f"{CUSTOMER_API_PREFIX}/correlation/write", operation_id="correlationWrite")
    async def write():
        return {"ok": True}

    try:
        yield app, logs, observations
    finally:
        logger.remove(sink)


@pytest.mark.parametrize("incoming", ["customer-123", None, "bad value!", "x" * 129])
@pytest.mark.parametrize(
    "kind,status",
    [
        ("400", 400),
        ("401", 401),
        ("409", 409),
        ("503", 503),
        ("unhandled", 500),
        ("framework", 404),
        ("validate", 422),
        ("method", 405),
    ],
)
def test_application_failures_share_one_validated_correlation(runtime, incoming, kind, status):
    app, logs, observations = runtime
    headers = {"X-Request-ID": incoming} if incoming is not None else {}
    with TestClient(app, raise_server_exceptions=False) as client:
        if kind == "validate":
            response = client.get(
                f"{CUSTOMER_API_PREFIX}/correlation/validate?count=invalid", headers=headers
            )
        elif kind == "method":
            response = client.post(f"{CUSTOMER_API_PREFIX}/correlation/validate", headers=headers)
        else:
            response = client.get(f"{CUSTOMER_API_PREFIX}/correlation/fail/{kind}", headers=headers)
    assert response.status_code == status
    identity = response.json()["request_id"]
    assert REQUEST_ID_PATTERN.fullmatch(identity)
    assert response.headers["X-Request-ID"] == identity
    assert observations == [(identity, identity)]
    assert identity == incoming if incoming == "customer-123" else identity != incoming
    assert logs
    assert all(ambient == record["request_id"] == identity for ambient, record in logs)


@pytest.mark.parametrize("origin", [None, "https://untrusted.example"])
@pytest.mark.parametrize("logging", [False, True])
def test_early_security_failures_have_correlation_independently_of_logging(
    runtime, origin, logging
):
    app, _, observations = runtime
    if not logging:
        app.user_middleware = [
            item for item in app.user_middleware if item.cls is not LoggingMiddleware
        ]
    with TestClient(app) as client:
        client.cookies.set(AUTH_COOKIE_NAME, "session")
        headers = {"Origin": origin} if origin else {}
        client.headers.pop("Origin", None)
        response = client.post(f"{CUSTOMER_API_PREFIX}/correlation/write", headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "request_origin_invalid"
    identity = response.json()["request_id"]
    assert REQUEST_ID_PATTERN.fullmatch(identity)
    assert observations == [(identity, identity)]
    assert response.headers["X-Request-ID"] == identity


def test_cors_direct_responses_receive_correlation_before_user_middleware(runtime):
    app, _, observations = runtime
    with TestClient(app) as client:
        response = client.options(
            f"{CUSTOMER_API_PREFIX}/correlation/write",
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "POST",
                "X-Request-ID": "cors-preflight",
            },
        )
    assert response.status_code == 400
    assert response.headers["X-Request-ID"] == "cors-preflight"
    assert observations == [("cors-preflight", "cors-preflight")]
    assert response.text == "Disallowed CORS origin"


@pytest.mark.asyncio
async def test_sequential_requests_reset_context_and_do_not_reuse_generated_identity(
    runtime, monkeypatch
):
    import app.core.request_correlation as correlation

    original = correlation.uuid4
    generated = []

    def generate():
        value = original()
        generated.append(value.hex)
        return value

    monkeypatch.setattr(correlation, "uuid4", generate)
    app, _, observations = runtime
    assert get_request_id() is None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    ) as client:
        first = await client.get(f"{CUSTOMER_API_PREFIX}/correlation/fail/unhandled")
        assert get_request_id() is None
        second = await client.get(f"{CUSTOMER_API_PREFIX}/correlation/fail/400")
        assert get_request_id() is None
    assert len(generated) == 2 and len(set(generated)) == 2
    assert [first.json()["request_id"], second.json()["request_id"]] == generated
    assert observations == [(identity, identity) for identity in generated]


@pytest.mark.asyncio
async def test_concurrent_requests_keep_state_and_log_context_isolated(runtime):
    app, logs, _ = runtime
    started = 0
    both_started = asyncio.Event()
    seen = []

    @app.get(f"{CUSTOMER_API_PREFIX}/correlation/concurrent")
    async def overlap(request: Request):
        nonlocal started
        before = (request_correlation_id(request), get_request_id())
        started += 1
        if started == 2:
            both_started.set()
        await asyncio.wait_for(both_started.wait(), 5)
        after = (request_correlation_id(request), get_request_id())
        seen.append((before, after))
        raise AppException(code=CustomerErrorCode.VALIDATION_ERROR)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    ) as client:
        responses = await asyncio.gather(
            *[
                client.get(
                    f"{CUSTOMER_API_PREFIX}/correlation/concurrent",
                    headers={"X-Request-ID": identity},
                )
                for identity in ["request-A", "request-B"]
            ]
        )
    assert {(before, after) for before, after in seen} == {
        ((identity, identity), (identity, identity)) for identity in ["request-A", "request-B"]
    }
    assert {response.json()["request_id"] for response in responses} == {"request-A", "request-B"}
    assert all(
        response.headers["X-Request-ID"] == response.json()["request_id"] for response in responses
    )
    assert logs and all(ambient == record["request_id"] for ambient, record in logs)
    assert get_request_id() is None


@pytest.mark.asyncio
async def test_detached_task_cannot_retain_ambient_correlation_after_request_finishes(runtime):
    app, _, _ = runtime
    finished = asyncio.Event()
    detached = []

    async def work():
        await finished.wait()
        return get_request_id()

    @app.get(f"{CUSTOMER_API_PREFIX}/correlation/detached")
    async def detach():
        detached.append(asyncio.create_task(work()))
        return {"ok": True}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    ) as client:
        response = await client.get(f"{CUSTOMER_API_PREFIX}/correlation/detached")
    assert response.status_code == 200 and get_request_id() is None
    finished.set()
    assert await detached[0] is None


def test_tracing_wraps_the_framework_inside_the_correlation_lifecycle(runtime):
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.trace import get_current_span

    app, _, _ = runtime
    observed = []
    provider = TracerProvider()

    @app.get(f"{CUSTOMER_API_PREFIX}/correlation/traced")
    async def traced(request: Request):
        assert get_current_span().get_span_context().is_valid
        assert request_correlation_id(request) == get_request_id() == "traced-request"
        raise RuntimeError("traced error")

    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider,
        server_request_hook=lambda *_: observed.append(get_request_id()),
    )
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                f"{CUSTOMER_API_PREFIX}/correlation/traced",
                headers={"X-Request-ID": "traced-request"},
            )
        assert response.status_code == 500
        assert response.json()["request_id"] == response.headers["X-Request-ID"] == "traced-request"
        assert observed == ["traced-request"]
    finally:
        FastAPIInstrumentor.uninstrument_app(app)
        provider.shutdown()


@pytest.mark.parametrize(
    "model",
    [
        pytest.param("customer", id="customer"),
        pytest.param("control_plane", id="control-plane"),
    ],
)
@pytest.mark.parametrize(
    "identity",
    [
        "a",
        "a" * 128,
        "control:request.1_test-2",
        "",
        "a" * 129,
        "_request",
        "bad value",
        "request/1",
        "请求",
        "request\n",
    ],
)
def test_error_representations_admit_the_ingress_request_identity(model, identity):
    from pydantic import ValidationError
    from app.shared.responses import ApiErrorResponse
    from app.core.control_plane_errors import ControlPlaneErrorResponse
    from app.shared.request_id import REQUEST_ID_PATTERN

    response_type = ApiErrorResponse if model == "customer" else ControlPlaneErrorResponse
    code = (
        CustomerErrorCode.VALIDATION_ERROR
        if model == "customer"
        else ControlPlaneErrorCode.VALIDATION_ERROR
    )
    if REQUEST_ID_PATTERN.fullmatch(identity):
        assert response_type(code=code, request_id=identity).request_id == identity
    else:
        with pytest.raises(ValidationError):
            response_type(code=code, request_id=identity)


def test_error_request_identity_schema_matches_ingress_constraints():
    from app.shared.responses import ApiErrorResponse
    from app.core.control_plane_errors import ControlPlaneErrorResponse
    from app.shared.request_id import REQUEST_ID_PATTERN

    for model in (ApiErrorResponse, ControlPlaneErrorResponse):
        identity = model.model_json_schema()["properties"]["request_id"]
        assert identity["type"] == "string"
        assert identity["minLength"] == 1
        assert identity["maxLength"] == 128
        assert identity["pattern"] == REQUEST_ID_PATTERN.pattern


@pytest.mark.parametrize("code", ["", "custom_code" * 500])
def test_application_error_codes_require_contract_membership(code):
    from app.shared.responses import ApiErrorResponse
    from app.core.control_plane_errors import ControlPlaneErrorResponse

    from pydantic import ValidationError

    for model in (ApiErrorResponse, ControlPlaneErrorResponse):
        with pytest.raises(ValidationError):
            model(code=code, request_id="request")
