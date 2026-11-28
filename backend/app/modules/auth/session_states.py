"""Typed revocation reasons owned by Consumer authentication."""

from enum import StrEnum


class SessionRevocationReason(StrEnum):
    LOGOUT = "LOGOUT"
    DEVICE_REVOKED = "DEVICE_REVOKED"
    OTHER_SESSIONS = "OTHER_SESSIONS"
    PASSWORD_CHANGED = "PASSWORD_CHANGED"
    PASSWORD_RESET = "PASSWORD_RESET"
    ACCOUNT_CLOSED = "ACCOUNT_CLOSED"
