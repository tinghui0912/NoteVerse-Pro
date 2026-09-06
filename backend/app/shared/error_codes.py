"""Public error codes grouped by product domain."""


class CommonErrorCode:
    INTERNAL_ERROR = "internal_error"
    VALIDATION_ERROR = "validation_error"
    RESOURCE_NOT_FOUND = "resource_not_found"
    RESOURCE_ALREADY_EXISTS = "resource_already_exists"
    BUSINESS_RULE_VIOLATION = "business_rule_violation"
    UNKNOWN_ERROR = "unknown_error"


class AuthErrorCode:
    AUTH_FAILED = "auth_failed"
    UNAUTHORIZED = "unauthorized"
    TOKEN_INVALID_EXPIRED = "token_invalid_expired"
    CSRF_TOKEN_INVALID = "csrf_token_invalid"
    REQUEST_ORIGIN_INVALID = "request_origin_invalid"
    ACCOUNT_INACTIVE = "account_inactive"
    INVALID_CREDENTIALS = "invalid_credentials"
    EMAIL_MISMATCH = "email_mismatch"
    EMAIL_INVALID = "email_invalid"
    EMAIL_DELIVERY_UNAVAILABLE = "email_delivery_unavailable"
    RESET_TOKEN_INVALID = "reset_token_invalid"
    REQUEST_TOO_FREQUENT = "request_too_frequent"


class AccessErrorCode:
    NO_ACCESS = "no_access"
    NO_EDIT_ACCESS = "no_edit_access"
    NO_DELETE_ACCESS = "no_delete_access"
    NO_SHARE_ACCESS = "no_share_access"
    NO_DOWNLOAD_ACCESS = "no_download_access"


class ImportErrorCode:
    TASK_ERROR = "task_error"
    TASK_TIMEOUT = "task_timeout"
    JOB_NOT_FOUND = "job_not_found"
    JOB_RUNNING = "job_running"
    NO_FILE_IDS = "no_file_ids"
    INPUT_FILE_MISSING = "input_file_missing"
    SCORE_RECOGNITION_FAILED = "score_recognition_failed"


class ScoreErrorCode:
    SCORE_NOT_FOUND = "score_not_found"
    REVISION_NOT_FOUND = "revision_not_found"
    REVISION_CONFLICT = "revision_conflict"
    REVISION_CONTENT_INVALID = "revision_content_invalid"
    XML_NOT_FOUND = "xml_not_found"
    SCORE_PREVIEW_FAILED = "score_preview_failed"
    SCORE_PLAYBACK_FAILED = "score_playback_failed"
    SCORE_FINGERING_FAILED = "score_fingering_failed"
    INVALID_HAND_TYPE = "invalid_hand_type"
    INVALID_DEPTH = "invalid_depth"


class FileErrorCode:
    FILE_ERROR = "file_error"
    FILE_NOT_FOUND = "file_not_found"
    FILE_READ_FAILED = "file_read_failed"
    FILE_SAVE_FAILED = "file_save_failed"
    FILE_COPY_FAILED = "file_copy_failed"
    FILE_DELETE_FAILED = "file_delete_failed"
    FILE_TYPE_NOT_ALLOWED = "file_type_not_allowed"
    NO_FILE_SELECTED = "no_file_selected"
    STORAGE_QUOTA_EXCEEDED = "storage_quota_exceeded"
    QUOTA_CHECK_UNAVAILABLE = "quota_check_unavailable"


class SharingErrorCode:
    SHARE_NOT_FOUND = "share_not_found"
    SHARE_REVOKED = "share_revoked"
    SHARE_EXPIRED = "share_expired"
    SHARE_NO_DOWNLOAD = "share_no_download"
    INVITE_NOT_FOUND = "invite_not_found"
    INVITE_EXPIRED = "invite_expired"
    INVITE_REVOKED = "invite_revoked"
    INVITE_DECLINED = "invite_declined"
    INVITE_ALREADY_ACCEPTED = "invite_already_accepted"
    INVITE_EMAIL_MISMATCH = "invite_email_mismatch"
    MEMBERSHIP_NOT_FOUND = "membership_not_found"


class NotificationErrorCode:
    NOTIFICATION_NOT_FOUND = "notification_not_found"


class PracticeErrorCode:
    PRACTICE_SESSION_NOT_FOUND = "practice_session_not_found"
    PRACTICE_REPLAY_ARTIFACT_NOT_FOUND = "practice_replay_artifact_not_found"
    PRACTICE_SESSION_INVALID_STATE = "practice_session_invalid_state"
    PRACTICE_STREAM_NOT_READY = "practice_stream_not_ready"
    PRACTICE_STREAM_CLOSED = "practice_stream_closed"
    PRACTICE_AUDIO_FORMAT_UNSUPPORTED = "practice_audio_format_unsupported"
    PRACTICE_ALIGNMENT_FAILED = "practice_alignment_failed"
    PRACTICE_SCOPE_INVALID = "practice_scope_invalid"
    PRACTICE_SCOPE_TARGET_NOT_FOUND = "practice_scope_target_not_found"
    NO_PRACTICE_ACCESS = "no_practice_access"


class AccountErrorCode:
    USER_NOT_FOUND = "user_not_found"
    EMAIL_NOT_FOUND = "email_not_found"
    CURRENT_PASSWORD_REQUIRED = "current_password_required"
    CURRENT_PASSWORD_WRONG = "current_password_wrong"
    PASSWORD_TOO_SHORT = "password_too_short"
    NO_AVATAR = "no_avatar"
    AVATAR_PROCESS_FAILED = "avatar_process_failed"


class IntegrationErrorCode:
    FEATURE_TEMPORARILY_UNAVAILABLE = "feature_temporarily_unavailable"
    EXCEL_NOT_AVAILABLE = "excel_not_available"


class ErrorCode(
    CommonErrorCode,
    AuthErrorCode,
    AccessErrorCode,
    ImportErrorCode,
    ScoreErrorCode,
    FileErrorCode,
    SharingErrorCode,
    NotificationErrorCode,
    PracticeErrorCode,
    AccountErrorCode,
    IntegrationErrorCode,
):
    pass


__all__ = [
    "AccessErrorCode",
    "AccountErrorCode",
    "AuthErrorCode",
    "CommonErrorCode",
    "ErrorCode",
    "FileErrorCode",
    "ImportErrorCode",
    "IntegrationErrorCode",
    "NotificationErrorCode",
    "PracticeErrorCode",
    "ScoreErrorCode",
    "SharingErrorCode",
]
