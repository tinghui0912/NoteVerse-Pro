"""Domain-owned resource states."""

import enum


class PracticeBundleStatus(str, enum.Enum):
    CREATING = "CREATING"
    READY = "READY"
