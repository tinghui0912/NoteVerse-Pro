"""Domain-owned resource states."""

import enum


class ScoreInputAssetPurpose(str, enum.Enum):
    ORIGINAL_UPLOAD = "ORIGINAL_UPLOAD"
