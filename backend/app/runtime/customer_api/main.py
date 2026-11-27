"""FastAPI application entrypoint."""

from app.core.http_application import HttpApplication
from app.core.http_error_policy import HttpRuntimeErrorCodes

from app.api.runtime_endpoints import install_process_endpoints
from app.api.runtime_schemas import RootRead
from app.runtime.customer_api.router import api_router
from app.runtime.customer_api.context import get_context
from app.runtime.customer_api.settings import CustomerApiSettings

from app.core.generated.customer_browser_protocol import (
    CUSTOMER_API_PREFIX,
)
from app.core.http_runtime import install_http_runtime, normalized_cors_origins
from app.core.lifespan import app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.modules.guest_previews.http_policy import GuestPreviewCachePolicyMiddleware

from app.shared.error_codes import CustomerErrorCode
from app.shared.responses import error_response


from app.core.logger import configure_logging

context = get_context()
settings = context.settings
configure_logging(settings.LOG_FORMAT)
configure_uvicorn_logging()


def _cors_origins(config: CustomerApiSettings) -> list[str]:
    return normalized_cors_origins(config.BACKEND_CORS_ORIGINS)


def create_app() -> HttpApplication:
    """Create and configure the FastAPI application."""
    context = get_context()
    settings = context.settings

    app = HttpApplication(
        title=settings.PROJECT_NAME,
        description=f"{settings.PROJECT_NAME} API - Sheet Music Processing System",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{CUSTOMER_API_PREFIX}/openapi.json",
        lifespan=app_lifespan,
    )

    from app.runtime.checks import RuntimeChecks

    from app.runtime.browser_security import create_rate_limiter

    app.state.rate_limiter = create_rate_limiter(
        settings, redis_url=settings.REDIS_URL, surface="customer"
    )
    app.state.settings = settings
    app.state.sessions_service = context.sessions_service
    app.state.runtime_checks = RuntimeChecks(
        context.engine, work_root=settings.WORK_ROOT, broker_url=settings.CELERY_BROKER_URL
    )
    app.state.engine = context.engine
    app.state.session_factory = context.sessions
    app.state.storage = context.storage
    app.state.resources = context.resources
    app.state.deliveries = context.deliveries
    app.state.dispatches = context.dispatches
    from app.modules.fingering.execution import FingeringExecutionService

    app.state.fingering_execution = FingeringExecutionService(
        max_concurrency=settings.FINGERING_MAX_CONCURRENCY,
        queue_wait_seconds=settings.FINGERING_QUEUE_WAIT_SECONDS,
    )

    install_http_runtime(
        app,
        trusted_proxy_cidrs=tuple(settings.TRUSTED_PROXY_CIDRS),
        trusted_proxy_hops=settings.TRUSTED_PROXY_HOPS,
        error_codes=HttpRuntimeErrorCodes(
            validation_error=CustomerErrorCode.VALIDATION_ERROR,
            auth_failed=CustomerErrorCode.AUTH_FAILED,
            unauthorized=CustomerErrorCode.UNAUTHORIZED,
            resource_not_found=CustomerErrorCode.RESOURCE_NOT_FOUND,
            internal_error=CustomerErrorCode.INTERNAL_ERROR,
            unknown_error=CustomerErrorCode.UNKNOWN_ERROR,
            unsupported_media_type=CustomerErrorCode.UNSUPPORTED_MEDIA_TYPE,
            rate_limit_exceeded=CustomerErrorCode.RATE_LIMIT_EXCEEDED,
            rate_limit_unavailable=CustomerErrorCode.RATE_LIMIT_UNAVAILABLE,
            request_origin_invalid=CustomerErrorCode.REQUEST_ORIGIN_INVALID,
        ),
        error_response_factory=error_response,
        allowed_origins=frozenset(_cors_origins(settings)),
        multipart_allowed_paths=(f"{CUSTOMER_API_PREFIX}/me/avatar",),
        cors_origins=_cors_origins(settings),
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
