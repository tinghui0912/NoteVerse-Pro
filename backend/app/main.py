"""FastAPI application entrypoint."""

from fastapi import FastAPI
from starlette.exceptions import HTTPException

from app.core.exception_handlers import http_exception_handler

from app.api.runtime_endpoints import install_process_endpoints
from app.api.runtime_schemas import RootRead
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.settings.service_identity import CUSTOMER_API_PREFIX
from app.core.http_runtime import install_http_runtime, normalized_cors_origins
from app.core.lifespan import app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CookieCsrfSettings
from app.modules.guest_previews.http_policy import GuestPreviewCachePolicyMiddleware


configure_uvicorn_logging()


def _cors_origins() -> list[str]:
    return normalized_cors_origins(settings.BACKEND_CORS_ORIGINS)


def _csrf_settings() -> CookieCsrfSettings:
    prefix = CUSTOMER_API_PREFIX
    return CookieCsrfSettings(
        api_prefix=prefix,
        session_cookie_names=(settings.AUTH_COOKIE_NAME, settings.REFRESH_COOKIE_NAME),
        csrf_cookie_name=settings.CSRF_COOKIE_NAME,
        csrf_header_name=settings.CSRF_HEADER_NAME,
        exempt_paths=(
            f"{prefix}/auth/login",
            f"{prefix}/auth/refresh",
            f"{prefix}/auth/register",
            f"{prefix}/auth/email/",
            f"{prefix}/auth/password/",
        ),
        allowed_origins=lambda: tuple(_cors_origins()),
        debug=settings.DEBUG,
    )


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title=settings.PROJECT_NAME,
        description=f"{settings.PROJECT_NAME} API - Sheet Music Processing System",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{CUSTOMER_API_PREFIX}/openapi.json",
        lifespan=app_lifespan,
    )

    install_http_runtime(
        app,
        csrf_settings=_csrf_settings(),
        cors_origins=_cors_origins(),
    )
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_middleware(GuestPreviewCachePolicyMiddleware, api_prefix=CUSTOMER_API_PREFIX)

    app.include_router(api_router, prefix=CUSTOMER_API_PREFIX)
    install_process_endpoints(app, health_operation_ids=("healthLive", "healthReady"))

    @app.get("/", operation_id="serviceInfoGet")
    def root() -> RootRead:
        return {
            "message": f"Welcome to {settings.PROJECT_NAME} API",
            "version": "2.0.0",
            "docs": "/docs",
            "status": "operational",
        }

    return app


app = create_app()
