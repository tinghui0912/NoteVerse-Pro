"""Isolated FastAPI composition root for platform operator controls."""

from app.core.http_application import HttpApplication

from app.api.runtime_endpoints import install_process_endpoints
from app.core.config import settings
from app.core.control_plane_errors import control_plane_error_response
from app.core.control_plane_settings import require_control_plane_settings
from app.core.generated.control_plane_browser_protocol import CONTROL_PLANE_API_PREFIX
from app.api.control_plane import router as control_plane_router
from app.core.http_runtime import install_http_runtime
from app.core.lifespan import create_app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CookieCsrfSettings
from app.core.runtime_checks import RuntimeRole
from app.modules.platform_operators.router import login_operator


configure_uvicorn_logging()


def create_app() -> HttpApplication:
    """Create the runtime that accepts operator sessions and no customer routes."""

    control_settings = require_control_plane_settings()
    app = HttpApplication(
        title=f"{settings.PROJECT_NAME} Control Plane API",
        description="Platform operator API",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{CONTROL_PLANE_API_PREFIX}/openapi.json",
        lifespan=create_app_lifespan(RuntimeRole.CONTROL_PLANE),
    )
    install_http_runtime(
        app,
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
