"""Internal HTTP composition root for authoritative durable metrics."""

from fastapi import FastAPI

from app.api.health import create_health_router
from app.api.metrics import create_metrics_router
from app.core.config import settings
from app.core.exception_handlers import register_exception_handlers
from app.core.lifespan import create_app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import LoggingMiddleware
from app.core.runtime_checks import RuntimeRole
from app.core.tracing import configure_api_tracing


configure_uvicorn_logging()


def create_app() -> FastAPI:
    """Expose only internal health and database-backed Prometheus metrics."""

    app = FastAPI(
        title=f"{settings.PROJECT_NAME} Observability Exporter",
        description="Internal Prometheus exporter for durable application state",
        version="2.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=create_app_lifespan(RuntimeRole.OBSERVABILITY_EXPORTER),
    )
    app.add_middleware(LoggingMiddleware)
    register_exception_handlers(app)
    configure_api_tracing(app)
    app.include_router(create_health_router(include_redis=False, include_storage_quota_policy=False))
    app.include_router(create_metrics_router(include_database_metrics=True))
    return app


app = create_app()
