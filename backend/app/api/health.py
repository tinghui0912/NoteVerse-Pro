"""Process health endpoints for container orchestrators."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.runtime_checks import check_database_readiness, check_redis_readiness

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("/live")
async def liveness() -> dict[str, str]:
    """Report whether the API process can serve requests."""
    return {"status": "ok"}


@router.get("/ready")
async def readiness() -> JSONResponse:
    """Report API readiness without coupling it to optional feature dependencies."""
    database_ok = await check_database_readiness()
    redis_ok = await check_redis_readiness()

    if not database_ok:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "checks": {"database": "failed", "redis": "ok" if redis_ok else "degraded"},
            },
        )

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok" if redis_ok else "degraded",
            "checks": {"database": "ok", "redis": "ok" if redis_ok else "degraded"},
        },
    )
