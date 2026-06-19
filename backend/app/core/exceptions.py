"""Application and pipeline exception types.

All custom exceptions carry a stable error code instead of a hard-coded
human-readable message. Clients are expected to map the code to localized UI
text on their side.
"""

from collections.abc import Mapping
from typing import Optional

from fastapi import status

from app.shared.constants import ErrorCode

ErrorDetails = Mapping[str, object]


# ---------------------------------------------------------------------------
# Base application exception
# ---------------------------------------------------------------------------


class AppException(Exception):
    """Base class for all application-level exceptions."""

    def __init__(
        self,
        code: str = ErrorCode.UNKNOWN_ERROR,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Optional[ErrorDetails] = None,
    ):
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.details = dict(details or {})

    def __str__(self) -> str:
        return self.code


# ---------------------------------------------------------------------------
# API-facing exceptions used by HTTP handlers
# ---------------------------------------------------------------------------


class AuthenticationException(AppException):
    """Authentication failed."""

    def __init__(
        self,
        code: str = ErrorCode.AUTH_FAILED,
        details: Optional[ErrorDetails] = None,
    ):
        super().__init__(
            code=code,
            status_code=status.HTTP_401_UNAUTHORIZED,
            details=details,
        )


class UnauthorizedException(AppException):
    """The caller does not have permission for the requested action."""

    def __init__(
        self,
        code: str = ErrorCode.UNAUTHORIZED,
        details: Optional[ErrorDetails] = None,
    ):
        super().__init__(
            code=code,
            status_code=status.HTTP_403_FORBIDDEN,
            details=details,
        )


class ResourceNotFoundException(AppException):
    """The requested resource does not exist."""

    def __init__(
        self,
        resource_type: str,
        resource_id: Optional[str] = None,
        code: str = ErrorCode.RESOURCE_NOT_FOUND,
    ):
        details: dict[str, object] = {"resource_type": resource_type}
        if resource_id:
            details["resource_id"] = resource_id
        super().__init__(
            code=code,
            status_code=status.HTTP_404_NOT_FOUND,
            details=details,
        )


class ResourceAlreadyExistsException(AppException):
    """The resource already exists."""

    def __init__(self, resource_type: str, details: Optional[ErrorDetails] = None):
        _details: dict[str, object] = {"resource_type": resource_type}
        if details:
            _details.update(details)
        super().__init__(
            code=ErrorCode.RESOURCE_ALREADY_EXISTS,
            status_code=status.HTTP_409_CONFLICT,
            details=_details,
        )


class ValidationException(AppException):
    """Input validation failed."""

    def __init__(
        self,
        code: str = ErrorCode.VALIDATION_ERROR,
        field: Optional[str] = None,
        details: Optional[ErrorDetails] = None,
    ):
        _details: dict[str, object] = {}
        if field:
            _details["field"] = field
        if details:
            _details.update(details)
        super().__init__(
            code=code,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details=_details,
        )


class TaskException(AppException):
    """Task processing failed."""

    def __init__(
        self,
        code: str = ErrorCode.TASK_ERROR,
        task_id: Optional[str] = None,
        details: Optional[ErrorDetails] = None,
    ):
        _details: dict[str, object] = {}
        if task_id:
            _details["task_id"] = task_id
        if details:
            _details.update(details)
        super().__init__(
            code=code,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            details=_details,
        )


class FileException(AppException):
    """File operation failed."""

    def __init__(
        self,
        code: str = ErrorCode.FILE_ERROR,
        filename: Optional[str] = None,
        details: Optional[ErrorDetails] = None,
    ):
        _details: dict[str, object] = {}
        if filename:
            _details["filename"] = filename
        if details:
            _details.update(details)
        super().__init__(
            code=code,
            status_code=status.HTTP_400_BAD_REQUEST,
            details=_details,
        )


class ExternalServiceException(AppException):
    """An external dependency failed or is unavailable."""

    def __init__(
        self,
        service: str,
        code: str = ErrorCode.EXTERNAL_SERVICE_ERROR,
        details: Optional[ErrorDetails] = None,
    ):
        _details: dict[str, object] = {"service": service}
        if details:
            _details.update(details)
        super().__init__(
            code=code,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            details=_details,
        )


class BusinessRuleException(AppException):
    """A business rule was violated."""

    def __init__(
        self,
        code: str = ErrorCode.BUSINESS_RULE_VIOLATION,
        rule: Optional[str] = None,
        details: Optional[ErrorDetails] = None,
    ):
        _details: dict[str, object] = {}
        if rule:
            _details["rule"] = rule
        if details:
            _details.update(details)
        super().__init__(
            code=code,
            status_code=status.HTTP_400_BAD_REQUEST,
            details=_details,
        )


# ---------------------------------------------------------------------------
# Worker / pipeline exceptions
# ---------------------------------------------------------------------------


class PipelineException(AppException):
    """Base class for pipeline step failures."""

    def __init__(
        self,
        code: str = ErrorCode.UNKNOWN_ERROR,
        details: Optional[ErrorDetails] = None,
    ):
        super().__init__(
            code=code,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            details=details,
        )


class TimeoutException(PipelineException):
    """A pipeline step exceeded its allowed runtime."""

    def __init__(self, details: Optional[ErrorDetails] = None):
        super().__init__(code=ErrorCode.TASK_TIMEOUT, details=details)


class FileNotFoundException(PipelineException):
    """A required input or intermediate file is missing."""

    def __init__(self, details: Optional[ErrorDetails] = None):
        super().__init__(code=ErrorCode.INPUT_FILE_MISSING, details=details)


class OmrFailedException(PipelineException):
    """The configured OMR engine failed."""

    def __init__(
        self,
        code: str = ErrorCode.OMR_FAILED,
        details: Optional[ErrorDetails] = None,
    ):
        super().__init__(code=code, details=details)


class ScoreRenderException(PipelineException):
    """Base class for score rendering failures."""


class ScoreRenderFailedException(ScoreRenderException):
    """A configured score rendering engine failed."""

    def __init__(
        self,
        code: str = ErrorCode.SCORE_RENDER_FAILED,
        details: Optional[ErrorDetails] = None,
    ):
        super().__init__(code=code, details=details)
