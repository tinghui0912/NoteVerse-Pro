"""Domain-owned resource states."""

from enum import Enum


class StoragePlanCode(str, Enum):
    FREE = "FREE"
    PLUS = "PLUS"
    PRO = "PRO"


class StorageQuotaHoldStatus(str, Enum):
    HELD = "HELD"
    CONSUMED = "CONSUMED"
    RELEASED = "RELEASED"
    EXPIRED = "EXPIRED"
