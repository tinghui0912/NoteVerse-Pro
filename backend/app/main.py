"""FastAPI application entrypoint."""

from app.core.http_application import HttpApplication
from app.core.http_error_policy import HttpRuntimeErrorCodes

from app.api.runtime_endpoints import install_process_endpoints
from app.api.customer_security import customer_csrf_exempt_operation
from app.api.runtime_schemas import RootRead
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.generated.customer_browser_protocol import (
    CUSTOMER_API_PREFIX,
    AUTH_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
)
from app.core.http_runtime import install_http_runtime, normalized_cors_origins
from app.core.lifespan import app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CookieCsrfSettings
from app.modules.guest_previews.http_policy import GuestPreviewCachePolicyMiddleware

from app.shared.error_codes import CustomerErrorCode
from app.shared.responses import error_response


configure_uvicorn_logging()


def _cors_origins() -> list[str]:
    return normalized_cors_origins(settings.BACKEND_CORS_ORIGINS)


def _csrf_settings() -> CookieCsrfSettings:
    return CookieCsrfSettings(
        api_prefix=CUSTOMER_API_PREFIX,
        session_cookie_names=(AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME),
        csrf_cookie_name=CSRF_COOKIE_NAME,
        csrf_header_name=CSRF_HEADER_NAME,
        exempt_operation=customer_csrf_exempt_operation,
        allowed_origins=lambda: tuple(_cors_origins()),
        debug=settings.DEBUG,
    )


def create_app() -> HttpApplication:
    """Create and configure the FastAPI application."""

    app = HttpApplication(
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
        error_codes=HttpRuntimeErrorCodes(
            validation_error=CustomerErrorCode.VALIDATION_ERROR,
            auth_failed=CustomerErrorCode.AUTH_FAILED,
            unauthorized=CustomerErrorCode.UNAUTHORIZED,
            resource_not_found=CustomerErrorCode.RESOURCE_NOT_FOUND,
            internal_error=CustomerErrorCode.INTERNAL_ERROR,
            unknown_error=CustomerErrorCode.UNKNOWN_ERROR,
            csrf_token_invalid=CustomerErrorCode.CSRF_TOKEN_INVALID,
            request_origin_invalid=CustomerErrorCode.REQUEST_ORIGIN_INVALID,
        ),
        error_response_factory=error_response,
        csrf_settings=_csrf_settings(),
        cors_origins=_cors_origins(),
    )
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
