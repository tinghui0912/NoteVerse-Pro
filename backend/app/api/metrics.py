"""Prometheus scrape endpoint factories for HTTP runtime roles."""

from fastapi import APIRouter, Response
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import CONTENT_TYPE_LATEST, metrics_content
from app.db.session import get_session
from app.observability.async_operation_metrics import async_operation_metrics_text



def create_metrics_router(*, include_database_metrics: bool) -> APIRouter:
    """Create the metrics endpoint for one independently scraped runtime.

    Process metrics belong to every HTTP runtime. Durable business and scheduler
    metrics describe shared PostgreSQL state, so the API runtime is their single
    authoritative exporter. Re-exporting them from practice would duplicate
    time series and make scheduler alerts evaluate a non-scheduler service.
    """

    router = APIRouter(tags=["Metrics"])

    if not include_database_metrics:

        @router.get("/metrics", include_in_schema=False)
        async def prometheus_process_metrics() -> Response:
            """Expose only process-scoped metrics for this runtime."""

            return Response(content=metrics_content(), media_type=CONTENT_TYPE_LATEST)

        return router

    @router.get("/metrics", include_in_schema=False)
    async def prometheus_metrics(db: AsyncSession = Depends(get_session)) -> Response:
        """Expose process and authoritative database-backed metrics."""

        content = metrics_content() + (await async_operation_metrics_text(db)).encode("utf-8")
        return Response(content=content, media_type=CONTENT_TYPE_LATEST)

    return router


router = create_metrics_router(include_database_metrics=True)
