"""Internal HTTP composition root for authoritative durable metrics."""

from fastapi import FastAPI

from app.api.runtime_endpoints import install_process_endpoints
from app.core.config import settings
from app.core.http_runtime import install_http_runtime
from app.core.lifespan import create_app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.runtime_checks import RuntimeRole


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
    install_http_runtime(app)
    install_process_endpoints(
        app,
        include_database_metrics=True,
        include_redis_readiness=False,
        include_storage_quota_policy_readiness=False,
    )
    return app


app = create_app()
