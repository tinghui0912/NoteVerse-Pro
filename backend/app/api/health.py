"""Process health endpoints for container orchestrators."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.runtime_checks import (
    check_database_readiness,
    check_redis_readiness,
    check_storage_quota_policy_readiness,
)


def create_health_router(
    *,
    include_redis: bool = True,
    include_storage_quota_policy: bool = True,
) -> APIRouter:
    """Create role-appropriate process health endpoints.

    An exporter only needs PostgreSQL to project durable metrics. Requiring it
    to depend on Redis or the storage-quota policy would couple Prometheus
    scrape availability to unrelated customer-runtime dependencies.
    """

    router = APIRouter(prefix="/health", tags=["Health"])

    @router.get("/live")
    async def liveness() -> dict[str, str]:
        """Report whether this process can serve requests."""
        return {"status": "ok"}

    @router.get("/ready")
    async def readiness() -> JSONResponse:
        """Report readiness for this runtime's declared dependencies."""
        database_ok = await check_database_readiness()
        storage_quota_policy_ok = (
            await check_storage_quota_policy_readiness()
            if include_storage_quota_policy and database_ok
            else not include_storage_quota_policy
        )
        redis_ok = await check_redis_readiness() if include_redis else True

        checks = {"database": "ok" if database_ok else "failed"}
        if include_storage_quota_policy:
            checks["storage_quota_policy"] = "ok" if storage_quota_policy_ok else "failed"
        if include_redis:
            checks["redis"] = "ok" if redis_ok else "degraded"

        if not database_ok or not storage_quota_policy_ok:
            return JSONResponse(status_code=503, content={"status": "not_ready", "checks": checks})

        return JSONResponse(
            status_code=200,
            content={"status": "ok" if redis_ok else "degraded", "checks": checks},
        )

    return router


router = create_health_router()
