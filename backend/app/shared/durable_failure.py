"""Shared classification vocabulary for durable failure facts."""

from enum import StrEnum


class DurableFailureClass(StrEnum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    USER_ERROR = "user_error"
    SYSTEM_ERROR = "system_error"
