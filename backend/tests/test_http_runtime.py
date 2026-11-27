from app.platform.config.observability import ObservabilitySettings
from tests.support.http_errors import CUSTOMER_HTTP_ERRORS
from app.core.http_application import HttpApplication
from fastapi.middleware.cors import CORSMiddleware

from app.core.http_runtime import install_http_runtime, normalized_cors_origins
from app.core.middleware import LoggingMiddleware


def test_normalized_cors_origins_strips_trailing_slashes() -> None:
    assert normalized_cors_origins(["https://app.example/", "http://localhost:3000"]) == [
        "https://app.example",
        "http://localhost:3000",
    ]


def test_install_http_runtime_adds_only_requested_security_middleware(monkeypatch) -> None:
    registered_apps: list[HttpApplication] = []
    traced_apps: list[HttpApplication] = []
    monkeypatch.setattr(
        "app.core.http_runtime.register_exception_handlers",
        lambda app, **_: registered_apps.append(app),
    )
    monkeypatch.setattr(
        "app.core.http_runtime.configure_api_tracing", lambda app, config: traced_apps.append(app)
    )
    app = HttpApplication()
    app.state.settings = ObservabilitySettings(LOG_FORMAT="console")

    install_http_runtime(app, trusted_proxy_cidrs=(), **CUSTOMER_HTTP_ERRORS)

    assert [middleware.cls for middleware in app.user_middleware] == [LoggingMiddleware]
    assert registered_apps == [app]
    assert traced_apps == [app]


def test_install_http_runtime_preserves_explicit_cors_policy(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.core.http_runtime.register_exception_handlers", lambda _, **kwargs: None
    )
    monkeypatch.setattr(
        "app.core.http_runtime.configure_api_tracing", lambda _, *args, **kwargs: None
    )
    app = HttpApplication()
    app.state.settings = ObservabilitySettings(LOG_FORMAT="console")

    install_http_runtime(
        app, trusted_proxy_cidrs=(), **CUSTOMER_HTTP_ERRORS, cors_origins=["https://app.example"]
    )

    assert [middleware.cls for middleware in app.user_middleware] == [
        CORSMiddleware,
        LoggingMiddleware,
    ]
    cors_options = app.user_middleware[0].kwargs
    assert cors_options["allow_origins"] == ["https://app.example"]
    assert cors_options["allow_credentials"] is False
