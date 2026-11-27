"""Isolated FastAPI composition root for platform operator controls."""

from app.core.http_application import HttpApplication
from app.core.http_error_policy import HttpRuntimeErrorCodes

from app.api.runtime_endpoints import install_process_endpoints
from app.runtime.control_plane.context import get_context

from app.core.control_plane_errors import ControlPlaneErrorCode, control_plane_error_response
from app.core.generated.control_plane_browser_protocol import CONTROL_PLANE_API_PREFIX
from app.runtime.control_plane.router import router as control_plane_router
from app.core.http_runtime import install_http_runtime
from app.core.lifespan import create_app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CookieCsrfSettings
from app.platform.runtime import RuntimeRole
from app.runtime.control_plane.routers.platform_operators.router import login_operator


from app.core.logger import configure_logging

context = get_context()
settings = context.settings
configure_logging(settings.LOG_FORMAT)
configure_uvicorn_logging()


def create_app() -> HttpApplication:
    """Create the runtime that accepts operator sessions and no customer routes."""
    context = get_context()
    settings = context.settings

    control_settings = settings.to_security_settings()
    app = HttpApplication(
        title=f"{settings.PROJECT_NAME} Control Plane API",
        description="Platform operator API",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{CONTROL_PLANE_API_PREFIX}/openapi.json",
        lifespan=create_app_lifespan(RuntimeRole.CONTROL_PLANE),
    )
    from app.runtime.checks import RuntimeChecks

    app.state.settings = settings
    app.state.runtime_checks = RuntimeChecks(
        context.engine, broker_url=settings.REDIS_URL, control=settings.to_security_settings()
    )
    app.state.engine = context.engine
    app.state.session_factory = context.sessions
    app.state.deliveries = context.deliveries
    from app.modules.ops.query_service import OpsAsyncOperationQueryService
    from app.modules.ops.command_service import OpsAsyncOperationCommandService
    from app.modules.ops.schemas import AsyncOperationKind
    from app.platform.config.delivery import OpsDeliveryConfig

    app.state.ops_query = OpsAsyncOperationQueryService(
        OpsDeliveryConfig.model_validate(settings.model_dump())
    )
    d = context.deliveries
    app.state.ops_commands = OpsAsyncOperationCommandService(
        {
            AsyncOperationKind.IMPORT: d.imports.rearm_for_operator,
            AsyncOperationKind.REVISION_RENDER: d.render.rearm_for_operator,
            AsyncOperationKind.PLAYBACK: d.playback.rearm_for_operator,
            AsyncOperationKind.MAIL: d.mail.rearm_for_operator,
            AsyncOperationKind.SCORE_DELETION: d.score_deletion.rearm_for_operator,
            AsyncOperationKind.ACCOUNT_DELETION: d.account_deletion.rearm_for_operator,
            AsyncOperationKind.STORED_OBJECT_RETIREMENT: d.retirement.rearm_for_operator,
        },
        app.state.ops_query,
    )

    install_http_runtime(
        app,
        trusted_proxy_cidrs=tuple(settings.TRUSTED_PROXY_CIDRS),
        error_codes=HttpRuntimeErrorCodes(
            validation_error=ControlPlaneErrorCode.VALIDATION_ERROR,
            auth_failed=ControlPlaneErrorCode.AUTH_FAILED,
            unauthorized=ControlPlaneErrorCode.UNAUTHORIZED,
            resource_not_found=ControlPlaneErrorCode.RESOURCE_NOT_FOUND,
            internal_error=ControlPlaneErrorCode.INTERNAL_ERROR,
            unknown_error=ControlPlaneErrorCode.UNKNOWN_ERROR,
            csrf_token_invalid=ControlPlaneErrorCode.CSRF_TOKEN_INVALID,
            request_origin_invalid=ControlPlaneErrorCode.REQUEST_ORIGIN_INVALID,
        ),
        csrf_settings=CookieCsrfSettings(
            api_prefix=CONTROL_PLANE_API_PREFIX,
            session_cookie_names=(control_settings.auth_cookie_name,),
            csrf_cookie_name=control_settings.csrf_cookie_name,
            csrf_header_name=control_settings.csrf_header_name,
            exempt_operation=lambda operation: operation.endpoint is login_operator,
            allowed_origins=control_settings.cors_origins,
            debug=settings.DEBUG,
        ),
        cors_origins=list(control_settings.cors_origins),
        error_response_factory=control_plane_error_response,
    )
    app.include_router(control_plane_router)
    install_process_endpoints(app, health_operation_ids=("healthLive", "healthReady"))
    return app


app = create_app()
