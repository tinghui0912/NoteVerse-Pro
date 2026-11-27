"""Domain-owned resource states."""

import enum


class PlaybackAssetKind(str, enum.Enum):
    AUDIO = "AUDIO"


class PlaybackOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SUPERSEDED = "SUPERSEDED"
