from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.http_runtime import install_http_runtime, normalized_cors_origins
from app.core.middleware import CsrfProtectionMiddleware, LoggingMiddleware


def test_normalized_cors_origins_strips_trailing_slashes() -> None:
    assert normalized_cors_origins(["https://app.example/", "http://localhost:3000"]) == [
        "https://app.example",
        "http://localhost:3000",
    ]


def test_install_http_runtime_adds_only_requested_security_middleware(monkeypatch) -> None:
    registered_apps: list[FastAPI] = []
    traced_apps: list[FastAPI] = []
    monkeypatch.setattr(
        "app.core.http_runtime.register_exception_handlers",
        registered_apps.append,
    )
    monkeypatch.setattr("app.core.http_runtime.configure_api_tracing", traced_apps.append)
    app = FastAPI()

    install_http_runtime(app)

    assert [middleware.cls for middleware in app.user_middleware] == [LoggingMiddleware]
    assert registered_apps == [app]
    assert traced_apps == [app]


def test_install_http_runtime_preserves_explicit_cors_and_csrf_policy(monkeypatch) -> None:
    monkeypatch.setattr("app.core.http_runtime.register_exception_handlers", lambda _: None)
    monkeypatch.setattr("app.core.http_runtime.configure_api_tracing", lambda _: None)
    app = FastAPI()

    install_http_runtime(app, cors_origins=["https://app.example"])

    assert [middleware.cls for middleware in app.user_middleware] == [
        CORSMiddleware,
        LoggingMiddleware,
    ]
    cors_options = app.user_middleware[0].kwargs
    assert cors_options["allow_origins"] == ["https://app.example"]
    assert cors_options["allow_credentials"] is True
    assert CsrfProtectionMiddleware not in [middleware.cls for middleware in app.user_middleware]
