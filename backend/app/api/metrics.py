"""Prometheus scrape endpoint."""

from fastapi import APIRouter, Response
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.core.metrics import CONTENT_TYPE_LATEST, metrics_content
from app.db.session import get_session
from app.modules.ops.metrics_service import async_operation_metrics_text


router = APIRouter(tags=["Metrics"])


@router.get("/metrics", include_in_schema=False)
async def prometheus_metrics(db: AsyncSession = Depends(get_session)) -> Response:
    """Expose process metrics for Prometheus scraping."""

    content = metrics_content() + (await async_operation_metrics_text(db)).encode("utf-8")
    return Response(content=content, media_type=CONTENT_TYPE_LATEST)
