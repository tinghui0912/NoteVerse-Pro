"""Prometheus scrape endpoint factories for HTTP runtime roles."""

from fastapi import APIRouter, Response, Request
from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.metrics import CONTENT_TYPE_LATEST, metrics_content
from app.platform.db.dependencies import get_db
from app.observability.async_operation_metrics import async_operation_metrics_text, MetricsConfig


def create_metrics_router(*, include_database_metrics: bool) -> APIRouter:
    """Create the metrics endpoint for one independently scraped runtime.

    Process metrics belong to every HTTP runtime. Durable business and scheduler
    metrics describe shared PostgreSQL state, so only the dedicated
    observability-exporter runtime projects them. Re-exporting them from API or
    practice would duplicate time series and make scheduler alerts ambiguous.
    """

    router = APIRouter(tags=["Metrics"])

    if not include_database_metrics:

        @router.get("/metrics", include_in_schema=False)
        def prometheus_process_metrics() -> Response:
            """Expose only process-scoped metrics for this runtime."""

            return Response(content=metrics_content(), media_type=CONTENT_TYPE_LATEST)

        return router

    @router.get("/metrics", include_in_schema=False)
    def prometheus_metrics(request: Request, db: Session = Depends(get_db)) -> Response:
        """Expose process and authoritative database-backed metrics."""

        content = metrics_content() + (
            async_operation_metrics_text(
                db, config=MetricsConfig.model_validate(request.app.state.settings.model_dump())
            )
        ).encode("utf-8")
        return Response(content=content, media_type=CONTENT_TYPE_LATEST)

    return router
