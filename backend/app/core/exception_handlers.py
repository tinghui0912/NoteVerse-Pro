"""Centralized FastAPI exception handlers."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError

from app.core.exceptions import AppException
from app.core.logger import get_request_id, logger
from app.shared.constants import ErrorCode
from app.shared.responses import ErrorResponsePayload, error_response


def _error_payload(
    *,
    public_code: str,
    request_id: str | None,
) -> ErrorResponsePayload:
    return error_response(
        public_code=public_code,
        public_message=public_code,
        request_id=request_id,
    )


def _request_id(request: Request) -> str | None:
    return get_request_id() or request.headers.get("X-Request-ID")


def _request_log_context(request: Request) -> dict[str, object]:
    return {
        "request_id": _request_id(request),
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
            public_code=exc.code,
            request_id=_request_id(request),
        ),
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    errors = exc.errors()
    logger.bind(
        event="http.request_validation_failed",
        public_code=ErrorCode.VALIDATION_ERROR,
        status_code=422,
        **_request_log_context(request),
        **_validation_error_summary(errors),
    ).warning("Request validation failed")
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            public_code=ErrorCode.VALIDATION_ERROR,
            request_id=_request_id(request),
        ),
    )


async def pydantic_validation_exception_handler(
    request: Request,
    exc: PydanticValidationError,
) -> JSONResponse:
    errors = exc.errors()
    logger.bind(
        event="http.data_validation_failed",
        public_code=ErrorCode.VALIDATION_ERROR,
        status_code=422,
        **_request_log_context(request),
        **_validation_error_summary(errors),
    ).warning("Data validation failed")
    return JSONResponse(
        status_code=422,
        content=_error_payload(
            public_code=ErrorCode.VALIDATION_ERROR,
            request_id=_request_id(request),
        ),
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.bind(
        event="http.unhandled_exception",
        public_code=ErrorCode.INTERNAL_ERROR,
        status_code=500,
        exception_type=type(exc).__name__,
        **_request_log_context(request),
    ).opt(exception=exc).error("Unhandled exception")

    return JSONResponse(
        status_code=500,
        content=_error_payload(
            public_code=ErrorCode.INTERNAL_ERROR,
            request_id=_request_id(request),
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
