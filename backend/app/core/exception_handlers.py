"""Centralized FastAPI exception handlers."""

from enum import StrEnum

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError
from starlette.exceptions import HTTPException

from app.core.exceptions import AppException
from app.core.logger import logger
from app.core.request_correlation import request_correlation_id
from app.core.http_error_policy import (
    ErrorResponseFactory,
    HttpRuntimeErrorCodes,
    RateLimitHttpException,
)


def _error_payload(request: Request, *, code: StrEnum, request_id: str) -> dict[str, object]:
    factory: ErrorResponseFactory = request.app.state.error_response_factory
    return factory(code, request_id)


def _request_log_context(request: Request) -> dict[str, object]:
    return {
        "request_id": request_correlation_id(request),
        "method": request.method,
        "http_path": request.url.path,
    }


def _validation_error_summary(errors: list[dict[str, object]]) -> dict[str, object]:
    first_error = errors[0] if errors else {}
    loc = first_error.get("loc")
    location = ".".join(str(part) for part in loc) if isinstance(loc, list | tuple) else None
    return {
        "validation_error_count": len(errors),
        "validation_first_location": location,
        "validation_first_type": first_error.get("type"),
    }


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    logger.bind(
        event="http.app_exception",
        public_code=exc.code,
        status_code=exc.status_code,
        **_request_log_context(request),
    ).warning("Application exception")
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(
            request,
            code=exc.code,
            request_id=request_correlation_id(request),
        ),
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    codes: HttpRuntimeErrorCodes = request.app.state.http_error_codes
    errors = exc.errors()
    logger.bind(
        event="http.request_validation_failed",
        public_code=codes.validation_error,
        status_code=422,
        **_request_log_context(request),
        **_validation_error_summary(errors),
    ).warning("Request validation failed")
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            request,
            code=codes.validation_error,
            request_id=request_correlation_id(request),
        ),
    )


async def pydantic_validation_exception_handler(
    request: Request,
    exc: PydanticValidationError,
) -> JSONResponse:
    codes: HttpRuntimeErrorCodes = request.app.state.http_error_codes
    errors = exc.errors()
    logger.bind(
        event="http.data_validation_failed",
        public_code=codes.validation_error,
        status_code=422,
        **_request_log_context(request),
        **_validation_error_summary(errors),
    ).warning("Data validation failed")
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            request,
            code=codes.validation_error,
            request_id=request_correlation_id(request),
        ),
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    codes: HttpRuntimeErrorCodes = request.app.state.http_error_codes
    logger.bind(
        event="http.unhandled_exception",
        public_code=codes.internal_error,
        status_code=500,
        exception_type=type(exc).__name__,
        **_request_log_context(request),
    ).opt(exception=exc).error("Unhandled exception")

    return JSONResponse(
        status_code=500,
        content=_error_payload(
            request,
            code=codes.internal_error,
            request_id=request_correlation_id(request),
        ),
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Present framework request failures without forwarding exception details."""
    codes: HttpRuntimeErrorCodes = request.app.state.http_error_codes
    code = {
        400: codes.validation_error,
        401: codes.auth_failed,
        403: codes.unauthorized,
        404: codes.resource_not_found,
        422: codes.validation_error,
        415: codes.unsupported_media_type,
        429: codes.rate_limit_exceeded,
    }.get(
        exc.status_code,
        codes.internal_error if exc.status_code >= 500 else codes.unknown_error,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(request, code=code, request_id=request_correlation_id(request)),
        headers=exc.headers,
    )


async def rate_limit_exception_handler(
    request: Request, exc: RateLimitHttpException
) -> JSONResponse:
    codes: HttpRuntimeErrorCodes = request.app.state.http_error_codes
    code = codes.rate_limit_exceeded if exc.status_code == 429 else codes.rate_limit_unavailable
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(request, code=code, request_id=request_correlation_id(request)),
        headers={"Retry-After": str(exc.retry_after_seconds)},
    )


def register_exception_handlers(
    app: FastAPI,
    *,
    error_response_factory: ErrorResponseFactory,
    error_codes: HttpRuntimeErrorCodes,
) -> None:
    """Register all shared exception handlers on the FastAPI app."""

    app.state.error_response_factory = error_response_factory
    app.state.http_error_codes = error_codes
    app.add_exception_handler(RateLimitHttpException, rate_limit_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
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
