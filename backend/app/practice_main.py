"""FastAPI entrypoint for the realtime practice service."""

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.metrics import create_metrics_router
from app.core.config import settings
from app.core.settings.service_identity import CUSTOMER_API_PREFIX
from app.core.http_runtime import install_http_runtime, normalized_cors_origins
from app.core.lifespan import create_app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CookieCsrfSettings
from app.core.runtime_checks import RuntimeRole
from app.modules.practice.router import router as practice_router


configure_uvicorn_logging()


def _cors_origins() -> list[str]:
    return normalized_cors_origins(settings.BACKEND_CORS_ORIGINS)


def _csrf_settings() -> CookieCsrfSettings:
    return CookieCsrfSettings(
        api_prefix=CUSTOMER_API_PREFIX,
        session_cookie_names=(settings.AUTH_COOKIE_NAME, settings.REFRESH_COOKIE_NAME),
        csrf_cookie_name=settings.CSRF_COOKIE_NAME,
        csrf_header_name=settings.CSRF_HEADER_NAME,
        exempt_paths=(),
        allowed_origins=lambda: tuple(_cors_origins()),
        debug=settings.DEBUG,
    )


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.PROJECT_NAME} Practice Service",
        description=f"{settings.PROJECT_NAME} realtime practice API",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{CUSTOMER_API_PREFIX}/practice/openapi.json",
        lifespan=create_app_lifespan(RuntimeRole.PRACTICE),
    )

    install_http_runtime(
        app,
        csrf_settings=_csrf_settings(),
        cors_origins=_cors_origins(),
    )

    app.include_router(practice_router, prefix=f"{CUSTOMER_API_PREFIX}/practice", tags=["Practice"])
    app.include_router(health_router)
    app.include_router(create_metrics_router(include_database_metrics=False))

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "message": f"Welcome to {settings.PROJECT_NAME} Practice Service",
            "version": "2.0.0",
            "status": "operational",
        }

    return app


app = create_app()
