"""Mandatory operator MFA, authorization, session revocation and atomic audit behavior."""

from datetime import timedelta
from dataclasses import replace
import base64
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from tests.support.browser import BrowserTestClient as TestClient
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.db.models import (
    Operator,
    OperatorMfaChallenge,
    OperatorSession,
    OperatorRecoveryCode,
    OpsAuditEvent,
)
from app.modules.platform_operators.domain import OperatorRole
from app.modules.platform_operators.permissions import ROLE_PERMISSIONS
from app.modules.platform_operators.management_service import create_operator
from app.modules.platform_operators.service import AuditContext
from app.platform.security import totp
from app.platform.security.opaque_tokens import token_digest
from app.core.exceptions import AuthenticationException, AppException
from app.shared.time import utc_now
from tests.support.control_plane import (
    control_app as control_app,
    control_db as control_db,
    operator_client as operator_client,
    enroll_operator,
)

PASSWORD = "a-long-operator-password"
EMAIL = "operator@example.com"


def login(client):
    result = client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert result.status_code == 200, result.text
    return result


def seed(db, role=OperatorRole.SUPER_ADMIN):
    row = create_operator(db, email=EMAIL, password=PASSWORD, display_name="Operator", role=role)
    db.commit()
    return row


@pytest.mark.parametrize(
    "timestamp,expected",
    [
        (59, "287082"),
        (1111111109, "081804"),
        (1111111111, "050471"),
        (1234567890, "005924"),
        (2000000000, "279037"),
        (20000000000, "353130"),
    ],
)
def test_rfc_totp_vectors_and_replay(timestamp, expected):
    secret = base64.b32encode(b"12345678901234567890").decode()
    step = timestamp // 30
    assert totp.code_for_step(secret, step) == expected
    assert totp.verify_code(secret, expected, timestamp=timestamp) == step
    assert totp.verify_code(secret, expected, timestamp=timestamp, last_used_step=step) is None
    assert totp.verify_code(secret, expected, timestamp=timestamp + 30) == step
    assert totp.verify_code(secret, expected, timestamp=timestamp + 60) is None


def test_secrets_are_authenticated_encrypted_and_recovery_codes_are_high_entropy():
    from cryptography.fernet import Fernet, InvalidToken

    key = Fernet.generate_key().decode()
    secret = totp.generate_secret()
    cipher = totp.encrypt_secret(key, secret)
    assert secret not in cipher and totp.decrypt_secret(key, cipher) == secret
    with pytest.raises(InvalidToken):
        totp.decrypt_secret(Fernet.generate_key().decode(), cipher)
    codes = totp.generate_recovery_codes()
    assert len(set(codes)) == 10 and all(len(code.replace("-", "")) == 20 for code in codes)
    assert "NoteVerse%20Admin:" in totp.provisioning_uri(secret, EMAIL)


def test_password_login_only_issues_challenge_and_protected_routes_reject_it(
    control_app, control_db
):
    seed(control_db)
    with TestClient(control_app) as client:
        result = login(client)
        assert result.json()["purpose"] == "ENROLLMENT_REQUIRED"
        assert client.cookies.get("nv_admin_mfa") and not client.cookies.get("nv_admin_session")
        assert control_db.scalar(select(func.count()).select_from(OperatorSession)) == 0
        assert client.get("/api/v1/auth/me").status_code == 401
        assert client.get("/api/v1/operators").status_code == 401
        assert (
            client.post(
                "/api/v1/auth/login", data={"email": EMAIL, "password": PASSWORD}
            ).status_code
            == 415
        )
        challenge = control_db.scalar(select(OperatorMfaChallenge))
        assert challenge.token_hash != client.cookies.get("nv_admin_mfa")
        assert (
            timedelta(minutes=4, seconds=59)
            < challenge.expires_at - challenge.created_at
            <= timedelta(minutes=5)
        )


def test_enrollment_cookie_security_single_use_challenge_and_hashed_recovery(
    control_app, control_db
):
    row = seed(control_db)
    service = control_app.state.operator_authentication
    service.config = replace(service.config, cookie_secure=True)
    with TestClient(control_app, base_url="https://testserver") as client:
        response = login(client)
        cookie = next(
            c
            for c in response.headers.get_list("set-cookie")
            if c.startswith("__Host-nv_admin_mfa=") and "Max-Age=300" in c
        )
        assert (
            all(v in cookie for v in ("Secure", "HttpOnly", "Path=/", "SameSite=strict"))
            and "Domain=" not in cookie
        )
        old = client.cookies.get("__Host-nv_admin_mfa")
        started = client.post("/api/v1/auth/mfa/enroll/start")
        assert started.status_code == 200
        secret = started.json()["secret"]
        response = client.post(
            "/api/v1/auth/mfa/enroll/confirm",
            json={"code": totp.code_for_step(secret, int(utc_now().timestamp()) // 30)},
        )
        assert response.status_code == 200, response.text
        codes = response.json()["recovery_codes"]
        assert len(codes) == 10 and not client.cookies.get("__Host-nv_admin_mfa")
        cookie = next(
            c
            for c in response.headers.get_list("set-cookie")
            if c.startswith("__Host-nv_admin_session=") and "Max-Age=43200" in c
        )
        assert (
            all(v in cookie for v in ("Secure", "HttpOnly", "Path=/", "SameSite=strict"))
            and "Domain=" not in cookie
        )
        assert response.headers["cache-control"] == "no-store"
        hashes = control_db.scalars(select(OperatorRecoveryCode.code_hash)).all()
        assert set(hashes) == {token_digest(code) for code in codes}
        control_db.refresh(row)
        assert row.totp_enabled_at and secret not in row.totp_secret_encrypted
        client.cookies.set("__Host-nv_admin_mfa", old)
        assert (
            client.post("/api/v1/auth/mfa/enroll/confirm", json={"code": "000000"}).status_code
            == 401
        )


def test_totp_replay_and_recovery_code_reuse_are_rejected(control_app, control_db, monkeypatch):
    clock = utc_now()
    monkeypatch.setattr("app.modules.platform_operators.service.utc_now", lambda: clock)
    monkeypatch.setattr("tests.support.control_plane.utc_now", lambda: clock)
    seed(control_db)
    with TestClient(control_app) as client:
        secret, codes = enroll_operator(client)
        login(client)
        code = totp.code_for_step(secret, int(clock.timestamp()) // 30)
        assert client.post("/api/v1/auth/mfa/verify", json={"code": code}).status_code == 401
        now = clock + timedelta(seconds=30)
        monkeypatch.setattr("app.modules.platform_operators.service.utc_now", lambda: now)
        code = totp.code_for_step(secret, int(now.timestamp()) // 30)
        response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
        assert response.status_code == 200, response.text
        login(client)
        assert client.post("/api/v1/auth/mfa/verify", json={"code": code}).status_code == 401
        response = client.post("/api/v1/auth/mfa/verify", json={"recovery_code": codes[0]})
        assert response.status_code == 200 and response.json()["recovery_codes_remaining"] == 9
        login(client)
        assert (
            client.post("/api/v1/auth/mfa/verify", json={"recovery_code": codes[0]}).status_code
            == 401
        )
        assert (
            client.post(
                "/api/v1/auth/mfa/verify",
                json={"code": code, "recovery_code": codes[1]},
            ).status_code
            == 422
        )


@pytest.mark.parametrize("field", ["idle_expires_at", "absolute_expires_at"])
def test_operator_session_expiration(control_db, operator_client, field):
    row = control_db.scalar(select(OperatorSession))
    if field == "absolute_expires_at":
        row.created_at = utc_now() - timedelta(hours=13)
        row.last_seen_at = row.created_at
        row.idle_expires_at = utc_now() - timedelta(hours=2)
    setattr(row, field, utc_now() - timedelta(seconds=1))
    control_db.commit()
    assert operator_client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize("role", list(OperatorRole))
def test_static_permissions_cover_read_retry_and_management(control_app, control_db, role):
    seed(control_db, role)
    with TestClient(control_app) as client:
        enroll_operator(client)
        me = client.get("/api/v1/auth/me").json()
        assert set(me["permissions"]) == {p.value for p in ROLE_PERMISSIONS[role]}
        assert client.get("/api/v1/audit-logs").status_code == 200
        assert client.get("/api/v1/operators").status_code == (
            200 if role == OperatorRole.SUPER_ADMIN else 403
        )
        from app.db.models import MailOutbox, MailOutboxStatus

        row = MailOutbox(
            source_kind="ACCOUNT",
            source_id=1,
            category="auth",
            dedupe_key="role-policy",
            recipient="user@example.com",
            subject="Notice",
            text_body="Body",
            status=MailOutboxStatus.FAILED,
            failure_code="test",
            failure_stage="delivery",
            failure_classification="transient",
            failure_retryable=True,
        )
        control_db.add(row)
        control_db.commit()
        assert client.get("/api/v1/users").status_code == 200
        response = client.post(
            f"/api/v1/ops/async-operations/mail/{row.outbox_uuid}/retry",
            json={"reason": "Investigate failure"},
        )
        assert response.status_code == (403 if role == OperatorRole.SUPPORT_READONLY else 200)


@pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}, {"reason": "ab"}])
def test_management_requires_nonblank_reason(control_db, operator_client, body):
    row = control_db.scalar(select(Operator))
    response = operator_client.post(f"/api/v1/operators/{row.operator_uuid}/mfa/reset", json=body)
    assert response.status_code == 422
    control_db.refresh(row)
    assert row.totp_enabled_at


def test_last_administrator_continuity_and_atomic_operator_management(control_db, operator_client):
    row = control_db.scalar(select(Operator))
    response = operator_client.patch(
        f"/api/v1/operators/{row.operator_uuid}",
        json={"reason": "Reduce access", "role": "SUPPORT_READONLY", "status": "active"},
    )
    assert response.status_code == 409
    created = operator_client.post(
        "/api/v1/operators",
        json={
            "email": "second@example.com",
            "password": PASSWORD,
            "display_name": "Second",
            "role": "PLATFORM_OPERATOR",
            "reason": "Expand operations",
        },
    )
    assert created.status_code == 201, created.text
    identity = created.json()["operator_id"]
    audit = control_db.scalar(
        select(OpsAuditEvent).where(OpsAuditEvent.action == "operator.create")
    )
    assert audit.target_id == identity and audit.reason == "Expand operations"
    response = operator_client.post(
        f"/api/v1/operators/{row.operator_uuid}/mfa/reset",
        json={"reason": "Lost authenticator"},
    )
    assert response.status_code == 204
    assert operator_client.get("/api/v1/auth/me").status_code == 401
    assert login(operator_client).json()["purpose"] == "ENROLLMENT_REQUIRED"
    control_db.refresh(row)
    assert row.totp_enabled_at is None
    assert (
        control_db.scalar(
            select(func.count())
            .select_from(OperatorRecoveryCode)
            .where(OperatorRecoveryCode.operator_id == row.id)
        )
        == 0
    )


def test_management_audit_failure_rolls_back_state(control_db, operator_client, monkeypatch):
    from app.modules.ops.audit_service import OpsAuditService

    def failed(*args, **kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(OpsAuditService, "record_event", failed)
    response = operator_client.post(
        "/api/v1/operators",
        json={
            "email": "second@example.com",
            "password": PASSWORD,
            "display_name": "Second",
            "role": "PLATFORM_OPERATOR",
            "reason": "Expand operations",
        },
    )
    assert response.status_code == 500
    control_db.rollback()
    assert control_db.scalar(select(Operator).where(Operator.email == "second@example.com")) is None


def test_recovery_consumption_uses_distinct_pg_connections_and_only_one_result(
    control_app, control_db
):
    seed(control_db)
    service = control_app.state.operator_authentication
    context = AuditContext()
    raw, challenge = service.start_login(
        control_db, email=EMAIL, password=PASSWORD, context=context
    )
    secret, _ = service.start_enrollment(control_db, raw, context)
    _, _, codes = service.confirm_enrollment(
        control_db, raw, totp.code_for_step(secret, int(utc_now().timestamp()) // 30), context
    )
    control_db.commit()
    raw, _ = service.start_login(control_db, email=EMAIL, password=PASSWORD, context=context)
    control_db.commit()
    engine = control_db.get_bind()
    control_db.rollback()
    barrier = Barrier(2)

    def consume():
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                service.verify_mfa(db, raw, code=None, recovery_code=codes[0], context=context)
                db.commit()
                return True
            except AuthenticationException:
                db.commit()
                return False

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: consume(), range(2)))
    assert sorted(results) == [False, True]
    assert (
        control_db.scalar(
            select(func.count())
            .select_from(OperatorRecoveryCode)
            .where(OperatorRecoveryCode.consumed_at.is_not(None))
        )
        == 1
    )


@pytest.mark.parametrize("failure", ["expired", "attempts"])
def test_mfa_challenge_hard_deadline_and_attempt_budget(control_app, control_db, failure):
    seed(control_db)
    with TestClient(control_app) as client:
        login(client)
        response = client.post("/api/v1/auth/mfa/enroll/start")
        secret = response.json()["secret"]
        row = control_db.scalar(select(OperatorMfaChallenge))
        if failure == "expired":
            row.expires_at = utc_now() - timedelta(seconds=1)
        else:
            row.attempt_count = 5
        control_db.commit()
        result = client.post(
            "/api/v1/auth/mfa/enroll/confirm",
            json={"code": totp.code_for_step(secret, int(utc_now().timestamp()) // 30)},
        )
        assert result.status_code == 401
        assert control_db.scalar(select(func.count()).select_from(OperatorSession)) == 0


def test_password_failure_has_fixed_audit_reason_and_no_session(control_app, control_db):
    seed(control_db)
    with TestClient(control_app) as client:
        response = client.post(
            "/api/v1/auth/login", json={"email": EMAIL, "password": "wrong-password"}
        )
        assert response.status_code == 401
        assert not client.cookies.get("nv_admin_mfa") and not client.cookies.get("nv_admin_session")
        event = control_db.scalar(select(OpsAuditEvent))
        assert (
            event.action == "auth.login_failed"
            and event.reason == "auth login_failed"
            and event.outcome == "failed"
        )


@pytest.mark.parametrize("action", ["operator.update", "operator.password_reset"])
def test_role_change_and_password_reset_revoke_sessions_and_challenges(
    control_app, control_db, operator_client, action
):
    from app.modules.platform_operators.management_service import manage_operator, create_operator
    from app.modules.platform_operators.domain import OperatorStatus

    actor = control_db.scalar(select(Operator))
    target = create_operator(
        control_db,
        email="other@example.com",
        password=PASSWORD,
        display_name="Other",
        role=OperatorRole.PLATFORM_OPERATOR,
    )
    control_db.commit()
    service = control_app.state.operator_authentication
    context = AuditContext()
    raw, _ = service.start_login(control_db, email=target.email, password=PASSWORD, context=context)
    secret, _ = service.start_enrollment(control_db, raw, context)
    _, session, _ = service.confirm_enrollment(
        control_db, raw, totp.code_for_step(secret, int(utc_now().timestamp()) // 30), context
    )
    service.start_login(control_db, email=target.email, password=PASSWORD, context=context)
    control_db.commit()
    manage_operator(
        control_db,
        actor_id=actor.id,
        operator_uuid=target.operator_uuid,
        action=action,
        reason="Review account access",
        context=context,
        role=OperatorRole.SUPPORT_READONLY,
        status=OperatorStatus.ACTIVE,
        password="a-new-long-password",
    )
    control_db.commit()
    with pytest.raises(AuthenticationException):
        service.resolve_session(control_db, token=session)
    assert not control_db.scalars(
        select(OperatorMfaChallenge).where(
            OperatorMfaChallenge.operator_id == target.id,
            OperatorMfaChallenge.consumed_at.is_(None),
        )
    ).all()


def test_operator_idle_touch_is_throttled_and_capped(
    control_app, control_db, operator_client, monkeypatch
):
    row = control_db.scalar(select(OperatorSession))
    service = control_app.state.operator_authentication
    raw = operator_client.cookies.get("nv_admin_session")
    first = row.last_seen_at
    service.resolve_session(control_db, token=raw)
    control_db.flush()
    control_db.refresh(row)
    assert row.last_seen_at == first
    now = first + timedelta(minutes=10)
    monkeypatch.setattr("app.modules.platform_operators.service.utc_now", lambda: now)
    service.resolve_session(control_db, token=raw)
    control_db.commit()
    control_db.refresh(row)
    assert row.last_seen_at == now and row.idle_expires_at == now + timedelta(hours=2)
    row.idle_expires_at = row.absolute_expires_at
    control_db.commit()
    now = row.absolute_expires_at - timedelta(minutes=30)
    service.resolve_session(control_db, token=raw)
    control_db.commit()
    control_db.refresh(row)
    assert row.idle_expires_at == row.absolute_expires_at


def test_concurrent_administrator_changes_leave_one_active_administrator(control_app, control_db):
    from app.modules.platform_operators.management_service import manage_operator
    from app.modules.platform_operators.domain import OperatorStatus

    row = seed(control_db)
    second = create_operator(
        control_db,
        email="second@example.com",
        password=PASSWORD,
        display_name="Second",
        role=OperatorRole.SUPER_ADMIN,
    )
    for operator in (row, second):
        operator.totp_enabled_at = utc_now()
        operator.totp_secret_encrypted = totp.encrypt_secret(
            control_app.state.operator_authentication.config.encryption_key, totp.generate_secret()
        )
        operator.totp_last_used_step = 1
    control_db.commit()
    targets = [(row.id, second.operator_uuid), (second.id, row.operator_uuid)]
    engine = control_db.get_bind()
    control_db.rollback()
    barrier = Barrier(2)

    def disable(target):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            try:
                manage_operator(
                    db,
                    actor_id=target[0],
                    operator_uuid=target[1],
                    action="operator.update",
                    reason="Review access",
                    context=AuditContext(),
                    role=OperatorRole.SUPER_ADMIN,
                    status=OperatorStatus.DISABLED,
                )
                db.commit()
                return True
            except AppException:
                db.rollback()
                return False

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(disable, targets))
    assert sorted(results) == [False, True]
    assert (
        control_db.scalar(
            select(func.count())
            .select_from(Operator)
            .where(
                Operator.role == OperatorRole.SUPER_ADMIN, Operator.status == OperatorStatus.ACTIVE
            )
        )
        == 1
    )


def test_control_routes_have_explicit_permission_or_authentication_authority(control_app):
    from fastapi.routing import APIRoute, iter_route_contexts
    from app.runtime.control_plane.deps import get_current_operator

    public = {
        "operatorLogin",
        "operatorMfaEnrollmentStart",
        "operatorMfaEnrollmentConfirm",
        "operatorMfaVerify",
        "healthLive",
        "healthReady",
    }
    for context in iter_route_contexts(control_app.routes):
        route = context.original_route
        if not isinstance(route, APIRoute) or not context.include_in_schema:
            continue
        if context.operation_id in public:
            continue
        calls = [d.call for d in route.dependant.dependencies]
        if context.operation_id in {"operatorLogout", "operatorCurrentGet"}:
            assert get_current_operator in calls
        else:
            assert any(getattr(call, "required_permission", None) is not None for call in calls), (
                context.operation_id
            )


def test_operator_identity_policy_is_local_and_permissions_are_code_owned():
    from pathlib import Path
    from app.modules.platform_operators.domain import OperatorRole
    from app.modules.platform_operators.permissions import OperatorPermission, ROLE_PERMISSIONS

    assert set(ROLE_PERMISSIONS) == set(OperatorRole)
    assert set().union(*ROLE_PERMISSIONS.values()) == set(OperatorPermission)
    for relative in ("app/modules/platform_operators", "app/runtime/control_plane"):
        for source in Path(relative).rglob("*.py"):
            assert "oidc" not in source.read_text().lower()


def test_cli_bootstrap_creates_super_admin_requiring_enrollment_and_audit(control_db, monkeypatch):
    import sys
    from scripts import create_operator as command

    monkeypatch.setattr(
        sys,
        "argv",
        ["create_operator.py", "--email", "bootstrap@example.com", "--display-name", "Bootstrap"],
    )
    monkeypatch.setattr(command, "build_engine", lambda _: control_db.get_bind())
    args = command.parse_args()
    assert args.role == "SUPER_ADMIN"
    identity = command.create_operator(args, PASSWORD)
    operator = control_db.scalar(select(Operator).where(Operator.operator_uuid == identity))
    assert operator.role == OperatorRole.SUPER_ADMIN and operator.totp_enabled_at is None
    assert operator.password_hash.startswith("$argon2id$")
    event = control_db.scalar(
        select(OpsAuditEvent).where(OpsAuditEvent.action == "operator.bootstrap")
    )
    assert event.target_id == identity and event.actor_operator_id is None


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_deployed_operator_cookies_require_secure_mode(environment):
    from pydantic import ValidationError
    from app.runtime.control_plane.settings import ControlPlaneSettings

    with pytest.raises(ValidationError, match="Secure operator cookies"):
        ControlPlaneSettings(ENVIRONMENT=environment, CONTROL_PLANE_COOKIE_SECURE=False)


@pytest.mark.parametrize("first", ["management", "logout"])
def test_logout_and_management_follow_operator_session_audit_lock_order(
    control_app, control_db, first
):
    from sqlalchemy import event, text
    from threading import Event
    from queue import Queue
    from time import monotonic
    from app.modules.platform_operators.management_service import manage_operator
    from app.modules.platform_operators.domain import OperatorStatus

    seed(control_db)
    service = control_app.state.operator_authentication
    context = AuditContext()
    raw, _ = service.start_login(control_db, email=EMAIL, password=PASSWORD, context=context)
    secret, _ = service.start_enrollment(control_db, raw, context)
    operator, token, _ = service.confirm_enrollment(
        control_db, raw, totp.code_for_step(secret, int(utc_now().timestamp()) // 30), context
    )
    create_operator(
        control_db,
        email="other-admin@example.com",
        password=PASSWORD,
        display_name="Other",
        role=OperatorRole.SUPER_ADMIN,
    )
    control_db.commit()
    identity, actor_id = operator.operator_uuid, operator.id
    engine = control_db.get_bind()
    control_db.rollback()
    acquired, release = Event(), Event()
    first_pid, second_pid = Queue(), Queue()

    def run(kind, leader):
        with engine.connect() as connection:
            pid = connection.scalar(text("SELECT pg_backend_pid()"))
            connection.commit()
            (first_pid if leader else second_pid).put(pid)
            if leader:

                def paused(conn, cursor, statement, params, context, many):
                    if (
                        "FROM operators" in statement
                        and "FOR UPDATE" in statement
                        and not acquired.is_set()
                    ):
                        acquired.set()
                        assert release.wait(10)

                event.listen(connection, "after_cursor_execute", paused)
            with Session(connection) as db:
                if kind == "management":
                    manage_operator(
                        db,
                        actor_id=actor_id,
                        operator_uuid=identity,
                        action="operator.update",
                        reason="Review administrator access",
                        context=context,
                        role=OperatorRole.PLATFORM_OPERATOR,
                        status=OperatorStatus.ACTIVE,
                    )
                else:
                    service.revoke_session(db, token=token, context=context)
                db.commit()

    with ThreadPoolExecutor(2) as pool:
        leader = pool.submit(run, first, True)
        waiter = None
        try:
            assert acquired.wait(10)
            pid1 = first_pid.get(timeout=10)
            waiter = pool.submit(run, "logout" if first == "management" else "management", False)
            pid2 = second_pid.get(timeout=10)
            with engine.connect() as observer:
                deadline = monotonic() + 10
                while True:
                    blockers = observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": pid2})
                    if pid1 in blockers:
                        break
                    assert monotonic() < deadline, (
                        "Expected an observed PostgreSQL parent-lock wait"
                    )
                assert not observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": pid1})
        finally:
            release.set()
        leader.result(timeout=10)
        if waiter is not None:
            waiter.result(timeout=10)
    row = control_db.scalar(
        select(OperatorSession).where(OperatorSession.token_hash == token_digest(token))
    )
    assert row.revoked_at is not None
    management = control_db.scalar(
        select(OpsAuditEvent).where(OpsAuditEvent.action == "operator.update")
    )
    assert management.metadata_json["before"]["role"] == "SUPER_ADMIN"
    assert management.metadata_json["after"]["role"] == "PLATFORM_OPERATOR"
    actions = control_db.scalars(select(OpsAuditEvent.action)).all()
    assert actions.count("auth.logout") == 1 and actions.count("operator.update") == 1
