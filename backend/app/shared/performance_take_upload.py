"""Shared status vocabulary for Performance Take upload reservations."""

from enum import Enum


class UploadReservationStatus(str, Enum):
    RESERVED = "RESERVED"
    FINALIZING = "FINALIZING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
