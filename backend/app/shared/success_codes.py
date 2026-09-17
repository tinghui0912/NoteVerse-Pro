"""Public success codes grouped by product domain."""


class CommonSuccessCode:
    UPDATE_SUCCESS = "update_success"
    DELETE_SUCCESS = "delete_success"
    SAVE_SUCCESS = "save_success"


class ScoreSuccessCode:
    PREVIEW_GENERATED = "preview_generated"
    XML_SAVED = "xml_saved"
    XML_SAVED_WITH_IMAGES = "xml_saved_with_images"
    RECOGNITION_CONFIRMED = "recognition_confirmed"
    RECOGNITION_CONFIRMED_WITH_IMAGES = "recognition_confirmed_with_images"
    FINGERING_GENERATED = "fingering_generated"


class SharingSuccessCode:
    SHARE_CREATED = "share_created"
    SHARE_REMOVED = "share_removed"
    SHARE_SAVED = "share_saved"
    SHARE_ALREADY_SAVED = "share_already_saved"
    SHARES_DELETED = "shares_deleted"
    INVITE_CREATED = "invite_created"
    INVITE_ACCEPTED = "invite_accepted"
    INVITE_REVOKED = "invite_revoked"
    INVITE_DECLINED = "invite_declined"
    MEMBER_UPDATED = "member_updated"
    MEMBER_REMOVED = "member_removed"


class PracticeSuccessCode:
    PRACTICE_SESSION_CREATED = "practice_session_created"
    PRACTICE_SESSION_PAUSED = "practice_session_paused"
    PRACTICE_SESSION_RESUMED = "practice_session_resumed"
    PRACTICE_SESSION_FINISHED = "practice_session_finished"
    PRACTICE_REPLAY_SAVED = "practice_replay_saved"


class AccountSuccessCode:
    PROFILE_UPDATED = "profile_updated"
    PASSWORD_CHANGED = "password_changed"
    AVATAR_UPLOADED = "avatar_uploaded"
    AVATAR_DELETED = "avatar_deleted"


class FileSuccessCode:
    FILE_UPLOADED = "file_uploaded"
    FILE_DELETED = "file_deleted"


class AuthSuccessCode:
    EMAIL_VERIFIED = "email_verified"
    VERIFICATION_SUCCESS = "verification_success"
    PASSWORD_RESET_SUCCESS = "password_reset_success"
    LOGIN_SUCCESS = "login_success"
    LOGOUT_SUCCESS = "logout_success"
    SESSION_REVOKED = "session_revoked"
    SESSIONS_REVOKED = "sessions_revoked"


class ImportSuccessCode:
    TASKS_DELETED = "tasks_deleted"
    IMPORT_JOB_ACCEPTED = "import_job_accepted"


class SuccessCode(
    CommonSuccessCode,
    ScoreSuccessCode,
    SharingSuccessCode,
    PracticeSuccessCode,
    AccountSuccessCode,
    FileSuccessCode,
    AuthSuccessCode,
    ImportSuccessCode,
):
    pass


__all__ = [
    "AccountSuccessCode",
    "AuthSuccessCode",
    "CommonSuccessCode",
    "FileSuccessCode",
    "ImportSuccessCode",
    "PracticeSuccessCode",
    "ScoreSuccessCode",
    "SharingSuccessCode",
    "SuccessCode",
]
