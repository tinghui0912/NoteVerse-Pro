"""Shared types for score rendering engines."""

from __future__ import annotations

from typing import Literal, Protocol, TypedDict


class ScoreRenderOutputFile(TypedDict):
    """A rendered score page or document."""

    path: str
    page: int
    format: str
    mime_type: str


class ScoreRenderSuccessResult(TypedDict):
    """Successful score rendering result."""

    success: Literal[True]
    engine: str
    files: list[ScoreRenderOutputFile]
    stdout: str
    stderr: str


class ScoreRenderFailureResult(TypedDict, total=False):
    """Failed score rendering result."""

    success: Literal[False]
    engine: str
    error: str
    code: str
    stdout: str
    stderr: str


ScoreRenderResult = ScoreRenderSuccessResult | ScoreRenderFailureResult


class ScoreRenderEngine(Protocol):
    """Engine contract for rendering MusicXML into visual score assets."""

    engine_name: str
    default_output_format: str

    def render_score(
        self,
        *,
        xml_path: str,
        output_name: str,
        output_format: str | None = None,
    ) -> ScoreRenderResult:
        """Render a MusicXML score."""
