"""Shared process endpoints installed by HTTP composition roots."""

from fastapi import FastAPI

from app.api.health import create_health_router
from app.api.metrics import create_metrics_router


def install_process_endpoints(
    app: FastAPI,
    *,
    include_database_metrics: bool = False,
    include_redis_readiness: bool = True,
    include_storage_quota_policy_readiness: bool = True,
) -> None:
    """Install health and metrics endpoints owned by the process runtime."""

    app.include_router(
        create_health_router(
            include_redis=include_redis_readiness,
            include_storage_quota_policy=include_storage_quota_policy_readiness,
        )
    )
    app.include_router(create_metrics_router(include_database_metrics=include_database_metrics))
