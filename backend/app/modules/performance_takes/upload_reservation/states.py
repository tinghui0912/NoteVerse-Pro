"""Domain-owned resource states."""

from enum import Enum


class UploadReservationStatus(str, Enum):
    RESERVED = "RESERVED"
    FINALIZING = "FINALIZING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
