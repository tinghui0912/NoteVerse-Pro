"""Optical music recognition engine abstractions and factories."""

from .base import (
    OmrEngine,
    OmrFailureResult,
    OmrOutputFiles,
    OmrResult,
    OmrSuccessResult,
)
from .factory import create_omr_engine
from .legato import LegatoOmrEngine

__all__ = [
    "OmrEngine",
    "OmrFailureResult",
    "OmrOutputFiles",
    "OmrResult",
    "OmrSuccessResult",
    "LegatoOmrEngine",
    "create_omr_engine",
]
