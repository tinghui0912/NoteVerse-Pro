"""Authoritative opaque sessions, revocation races and HTTP cookie contracts."""

from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from time import monotonic
from types import SimpleNamespace
import pytest
from tests.support.browser import BrowserTestClient as TestClient
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session, sessionmaker
from redis.exceptions import ConnectionError
from app.db.models import User, UserSession
from app.platform.db.dependencies import get_db
from app.platform.security.passwords import hash_password
from app.platform.security.opaque_tokens import token_digest, generate_token
from app.platform.security.cookies import session_cookie_name
from app.modules.auth.session_states import SessionRevocationReason as Reason
from app.modules.auth.schemas import ForgotPasswordRequest, ResetPasswordRequest
from app.modules.auth.password_reset_service import PasswordResetService
from app.platform.config.application import AccountEmailConfig
from app.core.exceptions import AuthenticationException
from app.shared.time import utc_now
from tests.support.authentication import RedisMemory, session_service

PASSWORD = "correct-password-123"


@pytest.fixture
def auth_client(postgres_engine):
    from app.runtime.customer_api.main import create_app

    application = create_app()
    redis = RedisMemory()
    service = session_service(postgres_engine, redis=redis)
    application.state.sessions_service = service
    application.state.session_factory = sessionmaker(postgres_engine)
    with Session(postgres_engine) as db:
        db.add(
            User(
                id=1,
                email="login@example.com",
                display_name="Login",
                password_hash=hash_password(PASSWORD),
            )
        )
        db.commit()

    def database():
        with Session(postgres_engine) as db:
            yield db

    application.dependency_overrides[get_db] = database
    with TestClient(application, base_url="https://testserver") as client:
        yield client, application, service, redis, postgres_engine


def login(client):
    response = client.post(
        "/api/v1/auth/login", json={"email": "login@example.com", "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return response


@pytest.mark.parametrize("secure", [False, True])
def test_json_login_sets_host_cookie_and_never_returns_a_credential(auth_client, secure):
    client, app, _, _, engine = auth_client
    app.state.settings = app.state.settings.model_copy(update={"AUTH_COOKIE_SECURE": secure})
    response = login(client)
    name = session_cookie_name(secure)
    assert name in client.cookies
    cookie = next(
        value for value in response.headers.get_list("set-cookie") if value.startswith(name + "=")
    )
    assert "HttpOnly" in cookie and "Path=/" in cookie and "SameSite=lax" in cookie
    assert ("Secure" in cookie) == secure and "Domain=" not in cookie
    assert response.json()["email"] == "login@example.com"
    assert not {"token", "token_hash", "session_token"} & response.json().keys()
    with Session(engine) as db:
        row = db.scalar(select(UserSession))
        assert row.token_hash == token_digest(client.cookies[name])
        assert row.absolute_expires_at - row.created_at == timedelta(days=30)
        assert row.idle_expires_at - row.created_at == timedelta(days=14)
    assert client.get("/api/v1/me/profile").status_code == 200


def test_login_requires_json_and_mints_fresh_sessions(auth_client):
    client, _, _, _, engine = auth_client
    assert client.post(
        "/api/v1/auth/login", data={"username": "login@example.com", "password": PASSWORD}
    ).status_code in (415, 422)
    login(client)
    first = client.cookies["nv_session"]
    login(client)
    assert client.cookies["nv_session"] != first
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(UserSession)) == 2


def test_logout_invalidates_a_warmed_cache_on_the_next_request(auth_client):
    client, _, _, redis, engine = auth_client
    login(client)
    token = client.cookies["nv_session"]
    assert client.get("/api/v1/me/profile").status_code == 200
    key = "consumer-session:" + token_digest(token)
    assert key in redis.values
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 204 and key in redis.deletes and key not in redis.values
    client.cookies.set("nv_session", token)
    assert client.get("/api/v1/me/profile").status_code == 401


def test_password_change_rotates_current_and_revokes_other_devices(auth_client):
    client, _, service, redis, engine = auth_client
    login(client)
    old = client.cookies["nv_session"]
    with Session(engine) as db:
        other, _ = service.create_session(db, 1, user_agent="other")
        db.commit()
        service.authenticate(db, other)
    changed = client.put(
        "/api/v1/me/password",
        json={"current_password": PASSWORD, "new_password": "new-password-123"},
    )
    assert changed.status_code == 204, changed.text
    current = client.cookies["nv_session"]
    assert current not in (old, other)
    assert client.get("/api/v1/me/profile").status_code == 200
    for token in (old, other):
        client.cookies.set("nv_session", token)
        assert client.get("/api/v1/me/profile").status_code == 401
    with Session(engine) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(UserSession)
                .where(UserSession.revoked_at.is_(None))
            )
            == 1
        )


def test_wrong_current_password_preserves_credentials_and_session(auth_client):
    from app.platform.security.passwords import verify_password

    client, _, _, redis, engine = auth_client
    login(client)
    token = client.cookies["nv_session"]
    response = client.put(
        "/api/v1/me/password",
        json={"current_password": "wrong-password", "new_password": "new-password-123"},
    )
    assert response.status_code == 422
    assert client.cookies["nv_session"] == token
    assert client.get("/api/v1/me/profile").status_code == 200
    with Session(engine) as db:
        assert verify_password(PASSWORD, db.get(User, 1).password_hash)
        assert db.scalar(select(UserSession)).revoked_at is None


def test_reset_revokes_all_sessions_and_uses_fragment_links(auth_client, monkeypatch):
    client, app, service, redis, engine = auth_client
    from app.db.models import MailOutbox, AuthToken

    login(client)
    old = client.cookies["nv_session"]
    client.get("/api/v1/me/profile")
    reset = PasswordResetService(
        service, config=AccountEmailConfig(FRONTEND_BASE_URL="https://example.test")
    )
    raw = generate_token()
    monkeypatch.setattr(reset, "_new_token", lambda: raw)
    with Session(engine) as db:
        other, _ = service.create_session(db, 1, user_agent="phone")
        db.commit()
        service.authenticate(db, other)
        reset.request_password_reset(db, ForgotPasswordRequest(email="login@example.com"))
        mail = db.scalar(select(MailOutbox))
        assert "#token=" + raw in mail.text_body and "?token=" not in mail.text_body
        assert db.scalar(select(AuthToken)).token_hash == token_digest(raw)
        reset.reset_password(db, ResetPasswordRequest(token=raw, new_password="reset-password-123"))
    for token in (old, other):
        client.cookies.set("nv_session", token)
        assert client.get("/api/v1/me/profile").status_code == 401
        assert "consumer-session:" + token_digest(token) not in redis.values


@pytest.mark.parametrize("state", ["inactive", "closed"])
def test_user_state_is_authoritative_even_with_a_warm_session_hint(auth_client, state):
    from app.modules.account.deletion_service import AccountDeletionService

    client, _, service, redis, engine = auth_client
    login(client)
    client.get("/api/v1/me/profile")
    assert redis.values
    with Session(engine) as db:
        if state == "closed":
            AccountDeletionService(service).request_deletion(db, 1, current_password=PASSWORD)
        else:
            db.get(User, 1).is_active = False
        db.commit()
    assert client.get("/api/v1/me/profile").status_code == 401


@pytest.mark.parametrize("expiration", ["idle", "absolute"])
def test_expiration_is_checked_even_for_cached_sessions(auth_client, expiration):
    client, _, _, redis, engine = auth_client
    login(client)
    client.get("/api/v1/me/profile")
    with Session(engine) as db:
        row = db.scalar(select(UserSession))
        now = utc_now()
        row.created_at = now - timedelta(days=31)
        row.last_seen_at = now - timedelta(days=2)
        row.idle_expires_at = now - timedelta(seconds=1)
        if expiration == "absolute":
            row.absolute_expires_at = now - timedelta(seconds=1)
        db.commit()
    assert redis.values and client.get("/api/v1/me/profile").status_code == 401


def test_session_devices_expose_uuid_and_revoke_only_selected_device(auth_client):
    client, _, service, _, engine = auth_client
    login(client)
    with Session(engine) as db:
        _, row = service.create_session(db, 1, user_agent="phone")
        identity = row.id
        db.commit()
    response = client.get("/api/v1/me/sessions")
    assert response.status_code == 200
    items = response.json()["sessions"]
    assert len(items) == 2 and sum(row["is_current"] for row in items) == 1
    assert all("token_hash" not in row and "token" not in row for row in items)
    assert client.delete(f"/api/v1/me/sessions/{identity}").status_code == 204
    assert client.get("/api/v1/me/profile").status_code == 200


def test_revoke_other_sessions_preserves_current_cookie(auth_client):
    client, _, service, _, engine = auth_client
    login(client)
    current = client.cookies["nv_session"]
    with Session(engine) as db:
        other, _ = service.create_session(db, 1)
        db.commit()
    assert client.delete("/api/v1/me/sessions").status_code == 204
    with Session(engine) as db:
        with pytest.raises(AuthenticationException):
            service.authenticate(db, other)
        assert service.authenticate(db, current)[0].id == 1


def test_revoking_current_device_clears_both_cookies_and_denies_reuse(auth_client):
    client, _, _, _, _ = auth_client
    login(client)
    token = client.cookies["nv_session"]
    identity = client.get("/api/v1/me/sessions").json()["sessions"][0]["id"]
    response = client.delete(f"/api/v1/me/sessions/{identity}")
    assert response.status_code == 204
    assert not client.cookies.get("nv_session")
    client.cookies.set("nv_session", token)
    assert client.get("/api/v1/me/profile").status_code == 401


def test_touch_is_throttled_and_never_extends_absolute_expiry(auth_client, monkeypatch):
    client, _, service, _, engine = auth_client
    login(client)
    with Session(engine) as db:
        row = db.scalar(select(UserSession))
        created = row.last_seen_at
        absolute = row.absolute_expires_at
    client.get("/api/v1/me/profile")
    with Session(engine) as db:
        row = db.scalar(select(UserSession))
        assert row.last_seen_at == created
    future = utc_now() + timedelta(minutes=15)
    monkeypatch.setattr("app.modules.auth.sessions_service.utc_now", lambda: future)
    client.get("/api/v1/me/profile")
    with Session(engine) as db:
        row = db.scalar(select(UserSession))
        assert row.last_seen_at > created
        assert row.absolute_expires_at == absolute


def test_repeated_activity_caps_sliding_expiry_at_the_absolute_deadline(auth_client, monkeypatch):
    client, _, _, _, engine = auth_client
    login(client)
    with Session(engine) as db:
        row = db.scalar(select(UserSession))
        created, absolute = row.created_at, row.absolute_expires_at
    for day in (13, 26, 29):
        now = created + timedelta(days=day)
        monkeypatch.setattr("app.modules.auth.sessions_service.utc_now", lambda: now)
        assert client.get("/api/v1/me/profile").status_code == 200
        with Session(engine) as db:
            row = db.scalar(select(UserSession))
            assert row.absolute_expires_at == absolute
            assert row.idle_expires_at == min(now + timedelta(days=14), absolute)
    monkeypatch.setattr("app.modules.auth.sessions_service.utc_now", lambda: absolute)
    assert client.get("/api/v1/me/profile").status_code == 401


def test_redis_failure_and_late_cache_fill_cannot_restore_revoked_authority(
    auth_client, monkeypatch
):
    client, _, service, redis, engine = auth_client
    login(client)
    client.get("/api/v1/me/profile")
    payload = dict(redis.values)
    with Session(engine) as db:
        service.revoke_user_sessions(db, 1, reason=Reason.PASSWORD_RESET)
    redis.values.update(payload)
    assert client.get("/api/v1/me/profile").status_code == 401
    monkeypatch.setattr(redis, "get", lambda key: (_ for _ in ()).throw(ConnectionError("offline")))
    assert client.get("/api/v1/me/profile").status_code == 401


def test_revocation_rollback_preserves_session_and_cache(auth_client):
    client, _, service, redis, engine = auth_client
    login(client)
    token = client.cookies["nv_session"]
    client.get("/api/v1/me/profile")
    with Session(engine) as db:
        service.revoke_user_sessions(db, 1, reason=Reason.PASSWORD_RESET, commit=False)
        db.rollback()
    assert "consumer-session:" + token_digest(token) in redis.values
    assert client.get("/api/v1/me/profile").status_code == 200


def test_active_sessions_use_postgres_when_redis_read_and_eviction_fail(auth_client, monkeypatch):
    client, _, _, redis, _ = auth_client
    login(client)
    token = client.cookies["nv_session"]
    assert client.get("/api/v1/me/profile").status_code == 200

    def unavailable(*args, **kwargs):
        raise ConnectionError("offline")

    monkeypatch.setattr(redis, "get", unavailable)
    assert client.get("/api/v1/me/profile").status_code == 200
    monkeypatch.setattr(redis, "pipeline", unavailable)
    assert client.post("/api/v1/auth/logout").status_code == 204
    client.cookies.set("nv_session", token)
    assert client.get("/api/v1/me/profile").status_code == 401


def test_realtime_catchup_revalidates_the_session(auth_client):
    from app.runtime.customer_api.routers.realtime.router import _fetch_page

    client, app, service, _, engine = auth_client
    login(client)
    request = SimpleNamespace(app=app, cookies={"nv_session": client.cookies["nv_session"]})
    assert _fetch_page(request, 1, None).changes == ()
    with Session(engine) as db:
        service.revoke_user_sessions(db, 1, reason=Reason.PASSWORD_RESET)
    with pytest.raises(AuthenticationException):
        _fetch_page(request, 1, None)


def _wait_for_user_lock(engine, owner, contender):
    deadline = monotonic() + 10
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while not observer.scalar(
            text("SELECT :owner = ANY(pg_blocking_pids(:contender))"),
            {"owner": owner, "contender": contender},
        ):
            assert monotonic() < deadline, "Expected PostgreSQL User lock contention"


@pytest.mark.parametrize("winner", ["login", "closure"])
def test_login_and_closure_serialize_on_the_user_row(auth_client, winner):
    from app.modules.account.deletion_service import AccountDeletionService
    from app.modules.auth.service import AuthService

    client, _, service, _, engine = auth_client
    ready = Queue()

    def close(db):
        AccountDeletionService(service).request_deletion(db, 1, current_password=PASSWORD)
        db.commit()

    def contender():
        with Session(engine) as db:
            ready.put(db.scalar(text("SELECT pg_backend_pid()")))
            if winner == "login":
                close(db)
            else:
                with pytest.raises(AuthenticationException):
                    AuthService(service).login(db, "login@example.com", PASSWORD)

    with Session(engine) as owner, ThreadPoolExecutor(1) as pool:
        pid = owner.scalar(text("SELECT pg_backend_pid()"))
        owner.scalar(select(User).where(User.id == 1).with_for_update(key_share=True))
        if winner == "closure":
            AccountDeletionService(service).request_deletion(owner, 1, current_password=PASSWORD)
        future = pool.submit(contender)
        try:
            _wait_for_user_lock(engine, pid, ready.get(timeout=10))
            if winner == "login":
                result = AuthService(service).login(owner, "login@example.com", PASSWORD)
                raw = result.session_token
            else:
                owner.commit()
        finally:
            owner.rollback()
        future.result(timeout=10)
    with Session(engine) as db:
        assert not db.get(User, 1).is_active
        assert (
            db.scalar(
                select(func.count())
                .select_from(UserSession)
                .where(UserSession.revoked_at.is_(None))
            )
            == 0
        )
        if winner == "login":
            with pytest.raises(AuthenticationException):
                service.authenticate(db, raw)


def test_current_device_token_cannot_revoke_another_users_devices(auth_client):
    client, _, service, _, engine = auth_client
    login(client)
    with Session(engine) as db:
        db.add(User(id=2, email="other@example.com", password_hash=hash_password(PASSWORD)))
        db.commit()
        token, _ = service.create_session(db, 2)
        db.commit()
        with pytest.raises(AuthenticationException):
            service.revoke_other_user_sessions(db, 2, current_token=client.cookies["nv_session"])
        db.rollback()
        assert service.authenticate(db, token)[0].id == 2
