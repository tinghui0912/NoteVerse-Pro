"""Backend process role identifiers."""

from enum import StrEnum


class RuntimeRole(StrEnum):
    API = "api"
    CONTROL_PLANE = "control"
    OBSERVABILITY_EXPORTER = "observability-exporter"
    WORKER = "worker"
    BEAT = "beat"
    ALL = "all"
