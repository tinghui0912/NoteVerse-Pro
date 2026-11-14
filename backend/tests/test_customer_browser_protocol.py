"""Customer browser identity and HTTP route projections have explicit source owners."""

import importlib.util
import json
import os
import re
from copy import deepcopy
from http.cookies import SimpleCookie
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.core.generated import customer_browser_protocol as protocol
from app.core.settings.customer_session_security import CustomerSessionSecuritySettings
from app.core.settings.service_identity import ServiceIdentitySettings

ROOT = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
spec = importlib.util.spec_from_file_location(
    "customer_protocol_generator", ROOT / "scripts/generate_customer_browser_protocol.py"
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def sources():
    return generator.load_json(ROOT / generator.PROTOCOL), generator.load_json(
        ROOT / generator.OPENAPI
    )


def test_identity_projections_match_the_canonical_browser_protocol():
    identity, _ = sources()
    for key, name in generator.EXPORTS.items():
        assert getattr(protocol, name) == identity[key]
    assert generator.generate(ROOT, check=True) == 0
    for model in (CustomerSessionSecuritySettings, ServiceIdentitySettings):
        assert set(model.model_fields).isdisjoint(generator.EXPORTS.values())


def test_customer_composition_uses_the_generated_protocol():
    from app.main import _csrf_settings, create_app

    app = create_app()
    assert app.openapi_url == f"{protocol.CUSTOMER_API_PREFIX}/openapi.json"
    csrf = _csrf_settings()
    assert csrf.api_prefix == protocol.CUSTOMER_API_PREFIX
    assert csrf.session_cookie_names == (protocol.AUTH_COOKIE_NAME, protocol.REFRESH_COOKIE_NAME)
    assert csrf.csrf_cookie_name == protocol.CSRF_COOKIE_NAME
    assert csrf.csrf_header_name == protocol.CSRF_HEADER_NAME
    _, committed = sources()
    assert generator.operation_routes(app.openapi()) == generator.operation_routes(committed)


def test_projections_are_deterministic_and_preserve_distinct_authorities():
    identity, openapi = sources()
    reordered = dict(reversed(list(identity.items())))
    reordered_api = deepcopy(openapi)
    reordered_api["paths"] = dict(reversed(list(openapi["paths"].items())))
    expected = generator.projections(identity, openapi)
    assert generator.projections(reordered, reordered_api) == expected
    changed = {**identity, "api_prefix": "/api/v2"}
    projections = generator.projections(changed, openapi)
    assert projections[generator.PYTHON] != expected[generator.PYTHON]
    assert projections[generator.TYPESCRIPT] != expected[generator.TYPESCRIPT]
    assert projections[generator.ROUTES] == expected[generator.ROUTES]
    changed_api = deepcopy(openapi)
    path, item = next(iter(changed_api["paths"].items()))
    changed_api["paths"][path + "/resource"] = changed_api["paths"].pop(path)
    projections = generator.projections(identity, changed_api)
    assert projections[generator.ROUTES] != expected[generator.ROUTES]
    assert projections[generator.PYTHON] == expected[generator.PYTHON]


def test_generation_checks_missing_and_stale_outputs_without_mutation(tmp_path):
    identity, openapi = sources()
    for relative, value in [(generator.PROTOCOL, identity), (generator.OPENAPI, openapi)]:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")
    assert generator.generate(tmp_path, check=True) == 1
    assert not (tmp_path / generator.TYPESCRIPT).exists()
    assert generator.generate(tmp_path) == 0
    assert generator.generate(tmp_path, check=True) == 0
    path = tmp_path / generator.ROUTES
    path.write_text("drift", encoding="utf-8")
    assert generator.generate(tmp_path, check=True) == 1
    assert path.read_text() == "drift"
    assert generator.generate(tmp_path) == 0
    assert generator.generate(tmp_path, check=True) == 0


@pytest.mark.parametrize(
    "text",
    ['{"api_prefix":"/a","api_prefix":"/b"}', '{"api_prefix":NaN}', '{"api_prefix":Infinity}'],
)
def test_source_loading_rejects_noncanonical_json(tmp_path, text):
    source = tmp_path / "source.json"
    source.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError):
        generator.load_json(source)


@pytest.mark.parametrize(
    "change",
    [
        {"extra": "value"},
        {"api_prefix": "https://host/api"},
        {"api_prefix": "/api/"},
        {"auth_cookie_name": ""},
        {"csrf_header_name": "Header"},
        {"csrf_cookie_name": "a;b"},
    ],
)
def test_fixed_identity_source_rejects_unhandled_or_invalid_protocol(change):
    identity, _ = sources()
    with pytest.raises(ValueError):
        generator.validate_protocol({**identity, **change})


def test_deployment_configuration_owns_policy_not_browser_identity():
    identity, _ = sources()
    names = {key.upper() for key in identity if key != "api_prefix"}
    pattern = re.compile(r"^\s*[\"']?(?:" + "|".join(names) + r")[\"']?\s*[:=]", re.MULTILINE)
    paths = [
        *ROOT.glob("docker-compose*.yml"),
        *ROOT.glob("backend/.env*.example"),
        *ROOT.glob("apps/customer-web/.env*.example"),
        *ROOT.glob(".github/workflows/*.yml"),
        *ROOT.glob("deploy/**/*.env"),
    ]
    assert paths
    assert [
        str(path.relative_to(ROOT))
        for path in paths
        if pattern.search(path.read_text(encoding="utf-8"))
    ] == []


def test_gateway_customer_bindings_match_protocol_and_openapi_sources():
    import yaml

    _, api = sources()
    stream = generator.operation_routes(api)["realtimeEventsStream"]["url"]
    for path in (ROOT / "deploy").rglob("gateway.yaml"):
        documents = yaml.safe_load_all(path.read_text(encoding="utf-8"))
        web = next(
            doc for doc in documents if doc.get("metadata", {}).get("name") == "noteverse-web"
        )
        routes = web["spec"]["rules"]
        assert [rule["matches"][0]["path"]["value"] for rule in routes[:2]] == [
            stream,
            protocol.CUSTOMER_API_PREFIX,
        ]
        assert all(rule["backendRefs"][0]["name"] == "noteverse-backend-api" for rule in routes[:2])


@pytest.mark.parametrize(
    "identity,owner,method,mime",
    [
        ("guestPreviewPageView", "guest", "image", "image/svg+xml"),
        ("guestPreviewPlaybackStream", "guest", "audio", "audio/wav"),
        ("scoreRevisionPlaybackStream", "playback", "score_revision_delivery", "audio/mpeg"),
        ("scoreRenderAssetView", "asset", "render_asset_delivery", "image/png"),
        ("realtimeEventsStream", None, None, "text/event-stream"),
    ],
)
def test_openapi_native_route_metadata_reaches_the_real_customer_handler(
    identity, owner, method, mime, monkeypatch
):
    from app.api.deps import get_current_user, get_db
    from app.main import create_app
    from app.modules.guest_previews.dependencies import get_guest_preview_service
    from app.modules.playback.router import get_playback_delivery_service
    from app.modules.score_assets.dependencies import get_score_asset_service
    from tests.support.object_storage import InMemoryObjectStorage

    app = create_app()
    storage = InMemoryObjectStorage()
    storage.put_bytes(key="native", content=b"native bytes", content_type=mime)
    delivery = SimpleNamespace(storage_key="native", filename="native", media_type=mime)
    from app.storage import AsyncObjectStorage

    service = SimpleNamespace(storage=storage, async_storage=AsyncObjectStorage(storage))
    dependencies = {
        "guest": get_guest_preview_service,
        "playback": get_playback_delivery_service,
        "asset": get_score_asset_service,
    }
    if owner:
        setattr(service, method, AsyncMock(return_value=delivery))
        app.dependency_overrides[dependencies[owner]] = lambda: service

    async def database():
        yield object()

    async def events(*args):
        yield ": connected\n\n"

    monkeypatch.setattr("app.modules.realtime.router._event_stream", events)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    _, api = sources()
    route = generator.operation_routes(api)[identity]
    url = re.sub(r"\{[^}]+\}", "resource", route["url"])
    with TestClient(app) as client:
        response = client.request(route["method"], url)
    assert response.status_code == 200
    assert response.headers["content-type"].split(";")[0] == mime
    assert response.content == (b": connected\n\n" if owner is None else b"native bytes")
    if owner:
        getattr(service, method).assert_awaited_once()


def test_login_refresh_logout_use_canonical_customer_cookie_identity():
    from app.api.deps import get_db
    from app.main import create_app
    from app.modules.auth.dependencies import get_auth_service, get_session_service

    app = create_app()
    auth = SimpleNamespace(login=AsyncMock(return_value=("access-one", "refresh-one")))
    sessions = SimpleNamespace(
        refresh_session=AsyncMock(return_value=("access-two", "refresh-two")),
        revoke_refresh_token=AsyncMock(),
    )

    async def database():
        yield object()

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_auth_service] = lambda: auth
    app.dependency_overrides[get_session_service] = lambda: sessions
    expected = {protocol.AUTH_COOKIE_NAME, protocol.REFRESH_COOKIE_NAME, protocol.CSRF_COOKIE_NAME}

    def cookies(response):
        result = SimpleCookie()
        for header in response.headers.get_list("set-cookie"):
            result.load(header)
        return result

    with TestClient(app, base_url="https://testserver") as client:
        login = client.post(
            f"{protocol.CUSTOMER_API_PREFIX}/auth/login",
            data={"username": "user@example.test", "password": "secret"},
        )
        assert login.status_code == 204
        assert login.content == b""
        assert set(cookies(login)) == expected
        csrf_before = client.cookies[protocol.CSRF_COOKIE_NAME]
        assert cookies(login)[protocol.AUTH_COOKIE_NAME]["httponly"]
        assert cookies(login)[protocol.REFRESH_COOKIE_NAME]["httponly"]
        assert not cookies(login)[protocol.CSRF_COOKIE_NAME]["httponly"]
        refresh = client.post(f"{protocol.CUSTOMER_API_PREFIX}/auth/refresh")
        assert refresh.status_code == 204
        assert refresh.content == b""
        assert set(cookies(refresh)) == expected
        assert client.cookies[protocol.AUTH_COOKIE_NAME] == "access-two"
        assert client.cookies[protocol.REFRESH_COOKIE_NAME] == "refresh-two"
        assert client.cookies[protocol.CSRF_COOKIE_NAME] != csrf_before
        assert sessions.refresh_session.await_args.args[1] == "refresh-one"
        rejected = client.post(f"{protocol.CUSTOMER_API_PREFIX}/auth/logout")
        assert rejected.status_code == 403
        logout = client.post(
            f"{protocol.CUSTOMER_API_PREFIX}/auth/logout",
            headers={protocol.CSRF_HEADER_NAME: client.cookies[protocol.CSRF_COOKIE_NAME]},
        )
        assert logout.status_code == 204
        assert logout.content == b""
        assert set(cookies(logout)) == expected
        assert all(cookies(logout)[name]["max-age"] == "0" for name in expected)
        assert all(client.cookies.get(name) is None for name in expected)
        assert sessions.revoke_refresh_token.await_args.args[1] == "refresh-two"
