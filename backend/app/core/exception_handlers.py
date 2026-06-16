"""Centralized FastAPI exception handlers."""

import traceback
from collections.abc import Sequence

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError

from app.core.config import settings
from app.core.exceptions import AppException
from app.core.logger import logger
from app.shared.constants import ErrorCode
from app.shared.responses import ErrorResponsePayload


def _error_payload(
    *,
    error: str,
    code: str,
    details: dict[str, object] | list[object] | Sequence[object] | None = None,
) -> ErrorResponsePayload:
    normalized_details: dict[str, object]
    if details is None:
        normalized_details = {}
    elif isinstance(details, dict):
        normalized_details = details
    else:
        normalized_details = {"items": list(details)}

    return {
        "success": False,
        "error": error,
        "code": code,
        "details": normalized_details,
    }


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    logger.warning(f"Application error: {exc.code} | details={exc.details}")
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(
            error=exc.code,
            code=exc.code,
            details=exc.details,
        ),
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    logger.warning(f"Request validation failed: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            error="Request validation failed",
            code=ErrorCode.VALIDATION_ERROR,
            details=exc.errors(),
        ),
    )


async def pydantic_validation_exception_handler(
    request: Request,
    exc: PydanticValidationError,
) -> JSONResponse:
    logger.warning(f"Data validation failed: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            error="Data validation failed",
            code=ErrorCode.VALIDATION_ERROR,
            details=exc.errors(),
        ),
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"Unhandled exception: {type(exc).__name__} - {exc}")
    logger.error(traceback.format_exc())

    return JSONResponse(
        status_code=500,
        content=_error_payload(
            error="Internal server error",
            code=ErrorCode.INTERNAL_ERROR,
            details={"type": type(exc).__name__} if settings.DEBUG else {},
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register all shared exception handlers on the FastAPI app."""

    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(
        RequestValidationError,
        validation_exception_handler,
    )
    app.add_exception_handler(
        PydanticValidationError,
        pydantic_validation_exception_handler,
    )
    app.add_exception_handler(Exception, general_exception_handler)
