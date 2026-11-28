"""Real HTTP origin admission and atomic Redis abuse authority."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4
import os
import pytest
from fastapi import Request, Response
from fastapi.testclient import TestClient
from redis import Redis
from redis.exceptions import ConnectionError
from app.platform.security.origin_guard import BrowserOriginGuard, normalize_origin
from app.platform.security.rate_limit import (
    RedisSlidingWindowLimiter,
    RateLimitBucket,
    normalized_email_digest,
    RateLimitUnavailableError,
)
from app.platform.config.browser_abuse import AuthenticationRatePolicy, MutationRatePolicy
from app.runtime.browser_security import get_rate_limiter
from tests.support.control_plane import control_app as control_app, control_db as control_db
from tests.test_authentication_session_contract import auth_client as auth_client


@pytest.fixture
def limiter():
    client = Redis.from_url(
        os.environ.get("NOTEVERSE_TEST_REDIS_URL", os.environ["REDIS_URL"]),
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    client.ping()
    instance = RedisSlidingWindowLimiter(client, namespace="test-security:" + uuid4().hex)
    yield instance
    for key in client.scan_iter(match=instance.namespace + ":*"):
        client.delete(key)
    client.close()


@pytest.fixture(params=["customer", "operator"])
def browser_app(request, control_app):
    if request.param == "customer":
        from app.runtime.customer_api.main import create_app

        app = create_app()
    else:
        app = control_app

    @app.api_route("/browser-admission", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
    async def admitted(request: Request):
        return Response(await request.body(), status_code=200)

    return app


@pytest.mark.parametrize(
    "headers,body,status",
    [
        ({"Origin": "http://testserver", "Sec-Fetch-Site": "cross-site"}, b"", 403),
        ({"Origin": "http://testserver", "Sec-Fetch-Site": "same-site"}, b"", 403),
        ({"Origin": "http://testserver", "Sec-Fetch-Site": "none"}, b"", 403),
        ({"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin, same-origin"}, b"", 403),
        ({"Origin": "null"}, b"", 403),
        ({"Origin": "https://evil.example"}, b"", 403),
        ({"Referer": "http://testserver/console"}, b"", 403),
        ({}, b"", 403),
        ({"Sec-Fetch-Site": "same-origin"}, b"", 200),
        ({"Origin": "http://testserver"}, b"", 200),
        (
            {"Origin": "http://testserver", "Content-Type": "application/json; charset=utf-8"},
            b"{}",
            200,
        ),
        ({"Origin": "http://testserver", "Content-Type": "text/plain"}, b"{}", 415),
        (
            {"Origin": "http://testserver", "Content-Type": "application/x-www-form-urlencoded"},
            b"x=y",
            415,
        ),
        (
            {"Origin": "http://testserver", "Content-Type": "multipart/form-data; boundary=test"},
            b"--test--",
            415,
        ),
        (
            {
                "Origin": "http://testserver",
                "Transfer-Encoding": "chunked",
                "Content-Type": "text/plain",
            },
            b"x",
            415,
        ),
    ],
)
@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_runtime_browser_admission(browser_app, headers, body, status, method):
    with TestClient(browser_app) as client:
        response = client.request(method, "/browser-admission", headers=headers, content=body)
    assert response.status_code == status
    if status in {403, 415}:
        assert response.json()["code"] == (
            "request_origin_invalid" if status == 403 else "unsupported_media_type"
        )
        assert response.json()["request_id"] == response.headers["X-Request-ID"]


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_safe_methods_ignore_browser_admission(browser_app, method):
    with TestClient(browser_app) as client:
        assert (
            client.request(
                method,
                "/browser-admission",
                headers={"Origin": "null", "Sec-Fetch-Site": "cross-site"},
            ).status_code
            == 200
        )


def test_exact_avatar_multipart_allowlist(control_app):
    from app.runtime.customer_api.main import create_app
    from app.runtime.customer_api.deps import get_current_user
    from app.core.exceptions import AuthenticationException

    app = create_app()

    def no_user():
        raise AuthenticationException()

    app.dependency_overrides[get_current_user] = no_user
    headers = {"Origin": "http://testserver", "Content-Type": "multipart/form-data; boundary=test"}
    with TestClient(app) as client:
        response = client.post("/api/v1/me/avatar", headers=headers, content=b"--test--")
        assert response.status_code == 401
        assert (
            client.post("/api/v1/me/avatar/", headers=headers, content=b"--test--").status_code
            == 415
        )
    with TestClient(control_app) as client:
        assert (
            client.post("/api/v1/me/avatar", headers=headers, content=b"--test--").status_code
            == 415
        )


def test_asgi_guard_does_not_read_or_buffer_body():
    messages = [
        {"type": "http.request", "body": b"first", "more_body": True},
        {"type": "http.request", "body": b"second", "more_body": False},
    ]
    observed = []

    async def receive():
        return messages.pop(0)

    async def send(message):
        observed.append(message)

    async def inner(scope, incoming, outgoing):
        assert len(messages) == 2
        while messages:
            await outgoing(await incoming())

    from starlette.responses import JSONResponse

    guard = BrowserOriginGuard(
        inner,
        allowed_origins=frozenset({"https://app.test"}),
        multipart_allowed_paths=(),
        error_response=lambda scope, status: JSONResponse({}, status_code=status),
    )
    asyncio.run(
        guard(
            {
                "type": "http",
                "method": "POST",
                "path": "/stream",
                "headers": [
                    (b"origin", b"https://app.test"),
                    (b"transfer-encoding", b"chunked"),
                    (b"content-type", b"application/json"),
                ],
            },
            receive,
            send,
        )
    )
    assert [item["body"] for item in observed] == [b"first", b"second"]


@pytest.mark.parametrize(
    "origin",
    ["*", "null", "https://app.test/path", "https://user@app.test", "https://app.test?x=1"],
)
def test_origin_configuration_rejects_ambiguous_authority(origin):
    with pytest.raises(ValueError):
        normalize_origin(origin)


def test_composite_quota_is_atomic_and_email_normalization_is_shared(limiter):
    email = normalized_email_digest("User@Example.com")
    assert email == normalized_email_digest(" user@example.com ")

    def buckets(ip):
        return [RateLimitBucket("ip", ip, 10, 60), RateLimitBucket("email", email, 2, 60)]

    assert limiter.check("login", buckets("one"), failure_mode="fail_closed").allowed
    assert limiter.check("login", buckets("two"), failure_mode="fail_closed").allowed
    denied = limiter.check("login", buckets("three"), failure_mode="fail_closed")
    assert not denied.allowed and denied.retry_after_seconds > 0 and denied.remaining == 0
    keys = list(limiter.client.scan_iter(match=limiter.namespace + ":*"))
    assert sorted(limiter.client.zcard(key) for key in keys) == [1, 1, 2]
    assert all(b"example.com" not in key for key in keys)


def test_independent_redis_connections_admit_exact_capacity(limiter):
    workers = 12
    barrier = Barrier(workers)
    url = os.environ.get("NOTEVERSE_TEST_REDIS_URL", os.environ["REDIS_URL"])

    def request(_):
        with Redis.from_url(url) as client:
            authority = RedisSlidingWindowLimiter(client, namespace=limiter.namespace)
            barrier.wait(timeout=10)
            return authority.check(
                "concurrent", [RateLimitBucket("user", "42", 5, 60)], failure_mode="fail_closed"
            ).allowed

    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(request, range(workers)))
    assert sum(results) == 5
    assert limiter.client.zcard(next(limiter.client.scan_iter(match=limiter.namespace + ":*"))) == 5


def test_sliding_window_prunes_expired_members_and_sets_bounded_ttl(limiter):
    bucket = [RateLimitBucket("user", "42", 1, 60)]
    assert limiter.check("window", bucket, failure_mode="fail_closed").allowed
    key = next(limiter.client.scan_iter(match=limiter.namespace + ":*"))
    seconds, micros = limiter.client.time()
    limiter.client.zadd(key, {"expired": seconds * 1000 + micros // 1000 - 61000})
    for member in limiter.client.zrange(key, 0, -1):
        if member != b"expired":
            limiter.client.zrem(key, member)
    assert limiter.check("window", bucket, failure_mode="fail_closed").allowed
    assert 0 < limiter.client.ttl(key) <= 60


class OfflineRedis:
    def eval(self, *args):
        raise ConnectionError("test authority unavailable")


def test_explicit_outage_modes():
    limiter = RedisSlidingWindowLimiter(OfflineRedis(), namespace="test-offline")
    with pytest.raises(RateLimitUnavailableError):
        limiter.check("login", [RateLimitBucket("ip", "one", 1, 60)], failure_mode="fail_closed")
    assert limiter.check(
        "mutation", [RateLimitBucket("user", "one", 1, 60)], failure_mode="fail_open"
    ).allowed
    with pytest.raises(ValueError):
        AuthenticationRatePolicy(
            ip_limit=1, identity_limit=1, window_seconds=60, failure_mode="fail_open"
        )


def test_customer_login_email_and_ip_limits_have_structured_retry_after(auth_client, limiter):
    client, app, *_ = auth_client
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    app.state.settings = app.state.settings.model_copy(
        update={
            "CUSTOMER_LOGIN_RATE_LIMIT": AuthenticationRatePolicy(
                ip_limit=3, identity_limit=1, window_seconds=60
            )
        }
    )

    def login(email):
        return client.post(
            "/api/v1/auth/login", json={"email": email, "password": "wrong-password-123"}
        )

    assert login("User@Example.com").status_code == 401
    response = login("user@example.com")
    assert response.status_code == 429 and response.json()["code"] == "rate_limit_exceeded"
    assert int(response.headers["Retry-After"]) >= 1
    assert login("two@example.com").status_code == 401
    assert login("three@example.com").status_code == 401
    assert login("four@example.com").status_code == 429


@pytest.mark.parametrize(
    "path,payload",
    [
        ("/auth/login", {"email": "user@example.com", "password": "correct-password-123"}),
        (
            "/auth/register",
            {
                "email": "user@example.com",
                "password": "correct-password-123",
                "display_name": "User",
            },
        ),
        ("/auth/password/forgot", {"email": "user@example.com"}),
        ("/auth/password/reset", {"token": "missing", "new_password": "correct-password-123"}),
    ],
)
def test_customer_sensitive_routes_fail_closed(auth_client, path, payload):
    client, app, *_ = auth_client
    app.dependency_overrides[get_rate_limiter] = lambda: RedisSlidingWindowLimiter(
        OfflineRedis(), namespace="offline"
    )
    response = client.post("/api/v1" + path, json=payload)
    assert response.status_code == 503 and response.json()["code"] == "rate_limit_unavailable"


@pytest.mark.parametrize(
    "path,payload",
    [
        ("/auth/login", {"email": "operator@example.com", "password": "correct-password-123"}),
        ("/auth/mfa/enroll/start", None),
        ("/auth/mfa/enroll/confirm", {"code": "123456"}),
        ("/auth/mfa/verify", {"code": "123456"}),
    ],
)
def test_operator_sensitive_routes_fail_closed(control_app, control_db, path, payload):
    control_app.dependency_overrides[get_rate_limiter] = lambda: RedisSlidingWindowLimiter(
        OfflineRedis(), namespace="offline"
    )
    with TestClient(control_app) as client:
        response = client.post(
            "/api/v1" + path, json=payload, headers={"Origin": "http://testserver"}
        )
    assert response.status_code == 503 and response.json()["code"] == "rate_limit_unavailable"


@pytest.mark.parametrize("dependency,capacity", [("upload", 2), ("revision", 3)])
def test_user_bursts_use_authenticated_identity_and_explicit_failure_mode(
    auth_client, limiter, dependency, capacity
):
    from fastapi import Depends
    from app.runtime.customer_api.deps import get_current_user
    from app.runtime.customer_api.rate_limits import limit_upload, limit_revision
    from types import SimpleNamespace

    client, app, *_ = auth_client
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=42)
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    name = (
        "CUSTOMER_UPLOAD_RATE_LIMIT" if dependency == "upload" else "CUSTOMER_REVISION_RATE_LIMIT"
    )
    app.state.settings = app.state.settings.model_copy(
        update={
            name: MutationRatePolicy(limit=capacity, window_seconds=60, failure_mode="fail_closed")
        }
    )
    selected = limit_upload if dependency == "upload" else limit_revision

    @app.post("/burst", dependencies=[Depends(selected)])
    def burst():
        return Response(status_code=204)

    for _ in range(capacity):
        assert client.post("/burst").status_code == 204
    response = client.post("/burst")
    assert response.status_code == 429 and int(response.headers["Retry-After"]) >= 1
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=43)
    assert client.post("/burst").status_code == 204
    app.dependency_overrides[get_rate_limiter] = lambda: RedisSlidingWindowLimiter(
        OfflineRedis(), namespace="offline"
    )
    assert client.post("/burst").status_code == 503
    app.state.settings = app.state.settings.model_copy(
        update={
            name: MutationRatePolicy(limit=capacity, window_seconds=60, failure_mode="fail_open")
        }
    )
    assert client.post("/burst").status_code == 204


def test_all_sensitive_routes_have_explicit_admission_dependencies(control_app):
    from fastapi.routing import iter_route_contexts
    from app.runtime.customer_api.main import create_app
    from app.runtime.customer_api.rate_limits import (
        limit_login,
        limit_registration,
        limit_recovery,
        limit_upload,
        limit_revision,
    )
    from app.runtime.control_plane.rate_limits import limit_login as operator_login, limit_mfa

    expected = {
        "authLogin": limit_login,
        "authRegister": limit_registration,
        "authEmailVerify": limit_recovery,
        "authPasswordResetRequest": limit_recovery,
        "authPasswordReset": limit_recovery,
        "accountEmailChangeRequest": limit_recovery,
        "authEmailChangeConfirm": limit_recovery,
        "uploadRequestsCreate": limit_upload,
        "performanceTakeUploadsReserve": limit_upload,
        "scoreRevisionsCreate": limit_revision,
        "scoreRevisionRestore": limit_revision,
    }
    operator_expected = {
        "operatorLogin": operator_login,
        "operatorMfaEnrollmentStart": limit_mfa,
        "operatorMfaEnrollmentConfirm": limit_mfa,
        "operatorMfaVerify": limit_mfa,
    }
    for app, policies in [(create_app(), expected), (control_app, operator_expected)]:
        routes = {
            route.operation_id: route.original_route
            for route in iter_route_contexts(app.routes)
            if getattr(route, "operation_id", None) in policies
        }
        assert set(routes) == set(policies)
        for identity, dep in policies.items():
            assert dep in [item.call for item in routes[identity].dependant.dependencies]


def test_operator_login_uses_normalized_mailbox_limits(control_app, control_db, limiter):
    control_app.state.settings = control_app.state.settings.model_copy(
        update={
            "OPERATOR_LOGIN_RATE_LIMIT": AuthenticationRatePolicy(
                ip_limit=10, identity_limit=1, window_seconds=60
            )
        }
    )
    control_app.dependency_overrides[get_rate_limiter] = lambda: limiter
    with TestClient(control_app, headers={"Origin": "http://testserver"}) as client:
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"email": "Operator@Example.com", "password": "wrong-password-123"},
            ).status_code
            == 401
        )
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "operator@example.com", "password": "wrong-password-123"},
        )
        assert response.status_code == 429 and response.json()["code"] == "rate_limit_exceeded"
        assert int(response.headers["Retry-After"]) >= 1


def test_mfa_windows_bind_both_challenge_and_operator(control_app, control_db, limiter):
    from fastapi import Depends
    from datetime import timedelta
    from app.modules.platform_operators.management_service import create_operator
    from app.modules.platform_operators.domain import ChallengePurpose, OperatorRole
    from app.db.models.operator import OperatorMfaChallenge
    from app.platform.security.opaque_tokens import token_digest
    from app.shared.time import utc_now
    from app.runtime.control_plane.rate_limits import limit_mfa

    operator = create_operator(
        control_db,
        email="limits@example.com",
        password="operator-password-123",
        display_name="Limits",
        role=OperatorRole.PLATFORM_OPERATOR,
    )
    control_db.flush()
    for raw in ("first-challenge", "second-challenge"):
        control_db.add(
            OperatorMfaChallenge(
                operator_id=operator.id,
                token_hash=token_digest(raw),
                purpose=ChallengePurpose.VERIFICATION_REQUIRED,
                expires_at=utc_now() + timedelta(minutes=5),
            )
        )
    control_db.commit()
    control_app.state.settings = control_app.state.settings.model_copy(
        update={
            "OPERATOR_MFA_RATE_LIMIT": AuthenticationRatePolicy(
                ip_limit=30, identity_limit=1, window_seconds=300
            ),
            "OPERATOR_MFA_IDENTITY_LIMIT": 2,
        }
    )
    control_app.dependency_overrides[get_rate_limiter] = lambda: limiter

    @control_app.post("/mfa-admission", dependencies=[Depends(limit_mfa)])
    def admitted():
        return Response(status_code=204)

    with TestClient(control_app, headers={"Origin": "http://testserver"}) as client:
        client.cookies.set("nv_admin_mfa", "first-challenge")
        assert client.post("/mfa-admission").status_code == 204
        assert client.post("/mfa-admission").status_code == 429
        client.cookies.set("nv_admin_mfa", "second-challenge")
        assert client.post("/mfa-admission").status_code == 204
        # A new challenge cannot acquire additional capacity for the same operator.
        control_app.state.settings = control_app.state.settings.model_copy(
            update={
                "OPERATOR_MFA_RATE_LIMIT": AuthenticationRatePolicy(
                    ip_limit=30, identity_limit=10, window_seconds=300
                )
            }
        )
        assert client.post("/mfa-admission").status_code == 429


def test_rate_limit_outage_warning_contains_only_reviewed_facts():
    from loguru import logger
    from app.core.logger import StructuredLogFieldPolicy

    records = []
    sink = logger.add(lambda message: records.append(message.record))
    try:
        limiter = RedisSlidingWindowLimiter(OfflineRedis(), namespace="offline")
        limiter.check(
            "login",
            [RateLimitBucket("email", "private@example.com", 1, 60)],
            failure_mode="fail_open",
        )
    finally:
        logger.remove(sink)
    facts = StructuredLogFieldPolicy.filter_extra(records[-1]["extra"])
    assert facts["event"] == "security.rate_limit_unavailable"
    assert facts["rate_limit_policy"] == "login"
    assert facts["failure_mode"] == "fail_open"
    assert facts["exception_type"] == "ConnectionError"
    assert "private@example.com" not in str(facts)


@pytest.mark.parametrize("action", ["password/reset", "email/verify", "email/change/confirm"])
def test_token_admission_identity_comes_only_from_its_record(auth_client, limiter, action):
    from datetime import timedelta
    from types import SimpleNamespace
    from unittest.mock import Mock
    from sqlalchemy.orm import Session
    from app.db.models.auth import AuthToken, PendingRegistration, EmailChangeRequest
    from app.runtime.customer_api.auth_services import (
        get_password_reset_service,
        get_email_change_service,
    )
    from app.runtime.customer_api.resources import get_email_verification_service
    from app.platform.security.opaque_tokens import token_digest
    from app.shared.time import utc_now

    client, app, _, _, engine = auth_client
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    app.state.settings = app.state.settings.model_copy(
        update={
            "CUSTOMER_RECOVERY_RATE_LIMIT": AuthenticationRatePolicy(
                ip_limit=20, identity_limit=1, window_seconds=60
            )
        }
    )
    raw = "record-bound-token"
    facts = {"token_hash": token_digest(raw), "expires_at": utc_now() + timedelta(minutes=5)}
    with Session(engine) as db:
        if action == "password/reset":
            db.add(AuthToken(user_id=1, purpose="password_reset", **facts))
            app.dependency_overrides[get_password_reset_service] = lambda: SimpleNamespace(
                reset_password=Mock()
            )
        elif action == "email/verify":
            db.add(
                PendingRegistration(
                    email="target@example.com",
                    display_name="Target",
                    password_hash="not-used-by-admission",
                    **facts,
                )
            )
            app.dependency_overrides[get_email_verification_service] = lambda: SimpleNamespace(
                verify_email=Mock(return_value={"id": 1, "email": "target@example.com"})
            )
        else:
            db.add(EmailChangeRequest(user_id=1, new_email="target@example.com", **facts))
            app.dependency_overrides[get_email_change_service] = lambda: SimpleNamespace(
                confirm_email_change=Mock(return_value=SimpleNamespace(email="target@example.com"))
            )
        db.commit()
    first = client.post(
        "/api/v1/auth/" + action,
        json={
            "token": raw,
            "new_password": "correct-password-123",
            "email": "attacker-one@example.com",
            "new_email": "injected-one@example.com",
        },
    )
    assert first.status_code in {200, 204}, first.text
    second = client.post(
        "/api/v1/auth/" + action,
        json={
            "token": raw,
            "new_password": "correct-password-123",
            "email": "attacker-two@example.com",
            "new_email": "injected-two@example.com",
        },
    )
    assert second.status_code == 429
    assert second.json()["code"] == "rate_limit_exceeded"
