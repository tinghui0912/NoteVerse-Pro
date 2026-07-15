"""Shared business codes that are safe to use outside feature modules."""

from app.shared.error_codes import ErrorCode


class SuccessCode:
    UPDATE_SUCCESS = "update_success"
    DELETE_SUCCESS = "delete_success"
    SAVE_SUCCESS = "save_success"

    PREVIEW_GENERATED = "preview_generated"
    XML_SAVED = "xml_saved"
    XML_SAVED_WITH_IMAGES = "xml_saved_with_images"
    RECOGNITION_CONFIRMED = "recognition_confirmed"
    RECOGNITION_CONFIRMED_WITH_IMAGES = "recognition_confirmed_with_images"
    FINGERING_GENERATED = "fingering_generated"

    SHARE_CREATED = "share_created"
    SHARE_REMOVED = "share_removed"
    SHARE_SAVED = "share_saved"
    SHARE_ALREADY_SAVED = "share_already_saved"
    INVITE_CREATED = "invite_created"
    INVITE_ACCEPTED = "invite_accepted"
    INVITE_REVOKED = "invite_revoked"
    INVITE_DECLINED = "invite_declined"
    MEMBER_UPDATED = "member_updated"
    MEMBER_REMOVED = "member_removed"

    PRACTICE_SESSION_CREATED = "practice_session_created"
    PRACTICE_SESSION_PAUSED = "practice_session_paused"
    PRACTICE_SESSION_RESUMED = "practice_session_resumed"
    PRACTICE_SESSION_FINISHED = "practice_session_finished"
    PRACTICE_REPORT_READY = "practice_report_ready"

    PROFILE_UPDATED = "profile_updated"
    PASSWORD_CHANGED = "password_changed"
    AVATAR_UPLOADED = "avatar_uploaded"
    AVATAR_DELETED = "avatar_deleted"

    FILE_UPLOADED = "file_uploaded"
    FILE_DELETED = "file_deleted"

    EMAIL_VERIFIED = "email_verified"
    VERIFICATION_SUCCESS = "verification_success"
    PASSWORD_RESET_SUCCESS = "password_reset_success"
    LOGIN_SUCCESS = "login_success"
    LOGOUT_SUCCESS = "logout_success"
    SESSION_REVOKED = "session_revoked"
    SESSIONS_REVOKED = "sessions_revoked"

    TASKS_DELETED = "tasks_deleted"
    SHARES_DELETED = "shares_deleted"
    IMPORT_JOB_ACCEPTED = "import_job_accepted"

__all__ = ["ErrorCode", "SuccessCode"]
