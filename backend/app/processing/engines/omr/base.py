"""Shared types for optical music recognition engines."""

from __future__ import annotations

from typing import Literal, Protocol, TypedDict


class OmrOutputFiles(TypedDict, total=False):
    """Files emitted by an OMR engine."""

    xml: str
    mxl: str
    abc: str
    raw_prediction: str
    log: str


class OmrSuccessResult(TypedDict):
    """Successful OMR result."""

    success: Literal[True]
    engine: str
    files: OmrOutputFiles
    stdout: str
    stderr: str


class OmrFailureResult(TypedDict):
    """Failed OMR result."""

    success: Literal[False]
    engine: str
    error: str
    code: str


OmrResult = OmrSuccessResult | OmrFailureResult


class OmrEngine(Protocol):
    """Engine contract for recognizing ordered score image pages."""

    engine_name: str

    def process_images(self, image_paths: list[str]) -> OmrResult:
        """Recognize ordered score image pages."""
