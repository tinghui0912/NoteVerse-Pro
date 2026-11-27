"""Versioned Control Plane operation and error schema authority."""

from fastapi import APIRouter
from app.core.generated.control_plane_browser_protocol import CONTROL_PLANE_API_PREFIX
from app.core.control_plane_errors import ControlPlaneErrorResponse
from app.modules.platform_operators.router import router as operator_router
from app.modules.ops.router import router as ops_router

router = APIRouter(
    prefix=CONTROL_PLANE_API_PREFIX,
    responses={
        "default": {"model": ControlPlaneErrorResponse},
        422: {"model": ControlPlaneErrorResponse},
    },
)
router.include_router(operator_router, prefix="/auth", tags=["Operator Authentication"])
router.include_router(ops_router, prefix="/ops", tags=["Operations"])
