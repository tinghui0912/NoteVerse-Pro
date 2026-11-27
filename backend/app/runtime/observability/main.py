"""Internal HTTP composition root for authoritative durable metrics."""

from app.core.http_application import HttpApplication
from app.core.http_error_policy import HttpRuntimeErrorCodes

from app.api.runtime_endpoints import install_process_endpoints
from app.runtime.observability.context import get_context

from app.core.http_runtime import install_http_runtime
from app.core.lifespan import create_app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.platform.runtime import RuntimeRole

from app.shared.error_codes import CustomerErrorCode
from app.shared.responses import error_response


from app.core.logger import configure_logging

context = get_context()
settings = context.settings
configure_logging(settings.LOG_FORMAT)
configure_uvicorn_logging()


def create_app() -> HttpApplication:
    """Expose only internal health and database-backed Prometheus metrics."""

    app = HttpApplication(
        title=f"{settings.PROJECT_NAME} Observability Exporter",
        description="Internal Prometheus exporter for durable application state",
        version="2.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=create_app_lifespan(RuntimeRole.OBSERVABILITY_EXPORTER),
    )
    from app.runtime.checks import RuntimeChecks

    app.state.settings = settings
    app.state.runtime_checks = RuntimeChecks(context.engine)
    app.state.engine = context.engine
    app.state.session_factory = context.sessions

    install_http_runtime(
        app,
        trusted_proxy_cidrs=(),
        error_response_factory=error_response,
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
    )
    install_process_endpoints(
        app,
        include_database_metrics=True,
        include_redis_readiness=False,
        include_storage_quota_policy_readiness=False,
    )
    return app


app = create_app()
