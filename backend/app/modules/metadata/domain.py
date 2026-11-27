"""Domain-owned resource states."""

import enum


class MetadataStatus(str, enum.Enum):
    PENDING = "PENDING"
    READY = "READY"
    FAILED = "FAILED"
