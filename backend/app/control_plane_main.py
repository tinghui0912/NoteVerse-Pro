"""Isolated FastAPI composition root for platform operator controls."""

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.metrics import create_metrics_router
from app.core.config import settings
from app.core.control_plane_settings import require_control_plane_settings
from app.core.http_runtime import install_http_runtime
from app.core.lifespan import create_app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CookieCsrfSettings
from app.core.runtime_checks import RuntimeRole
from app.modules.ops.router import router as ops_router
from app.modules.platform_operators.router import router as operator_auth_router


# The dedicated control host is the security and deployment boundary. Keeping
# the familiar versioned path inside that host avoids a second, artificial URL
# taxonomy while the two OpenAPI documents remain independently served.
CONTROL_PLANE_API_PREFIX = "/api/v1"


configure_uvicorn_logging()


def create_app() -> FastAPI:
    """Create the runtime that accepts operator sessions and no customer routes."""

    control_settings = require_control_plane_settings()
    app = FastAPI(
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
            exempt_paths=(f"{CONTROL_PLANE_API_PREFIX}/auth/login",),
            allowed_origins=control_settings.cors_origins,
            debug=settings.DEBUG,
        ),
        cors_origins=list(control_settings.cors_origins),
    )
    app.include_router(operator_auth_router, prefix=f"{CONTROL_PLANE_API_PREFIX}/auth", tags=["Operator Authentication"])
    app.include_router(ops_router, prefix=f"{CONTROL_PLANE_API_PREFIX}/ops", tags=["Operations"])
    app.include_router(health_router)
    app.include_router(create_metrics_router(include_database_metrics=False))
    return app


app = create_app()
