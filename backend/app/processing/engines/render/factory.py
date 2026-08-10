"""Factory for configured score rendering engines."""

from __future__ import annotations

from .base import ScoreRenderEngine
from .verovio import VerovioRenderEngine


def create_score_render_engine(
    *,
    output_folder: str,
    timeout_seconds: int | None = None,
) -> ScoreRenderEngine:
    """Create the supported score rendering engine."""

    return VerovioRenderEngine(
        output_folder=output_folder,
        timeout_seconds=timeout_seconds,
    )
