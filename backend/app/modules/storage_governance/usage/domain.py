"""Domain-owned resource states."""

import enum


class StorageUsageCategory(str, enum.Enum):
    SOURCE = "SOURCE"
    UPLOAD = "UPLOAD"
    INPUT_ASSET = "INPUT_ASSET"
    DERIVED_RENDER = "DERIVED_RENDER"
    DERIVED_AUDIO = "DERIVED_AUDIO"
    TEMP_IMPORT = "TEMP_IMPORT"
