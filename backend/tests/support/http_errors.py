from app.core.http_error_policy import HttpRuntimeErrorCodes
from app.shared.error_codes import CustomerErrorCode
from app.shared.responses import error_response

CUSTOMER_HTTP_ERRORS = dict(
    error_response_factory=error_response,
    error_codes=HttpRuntimeErrorCodes(
        validation_error=CustomerErrorCode.VALIDATION_ERROR,
        auth_failed=CustomerErrorCode.AUTH_FAILED,
        unauthorized=CustomerErrorCode.UNAUTHORIZED,
        resource_not_found=CustomerErrorCode.RESOURCE_NOT_FOUND,
        internal_error=CustomerErrorCode.INTERNAL_ERROR,
        unknown_error=CustomerErrorCode.UNKNOWN_ERROR,
        csrf_token_invalid=CustomerErrorCode.CSRF_TOKEN_INVALID,
        request_origin_invalid=CustomerErrorCode.REQUEST_ORIGIN_INVALID,
    ),
)
