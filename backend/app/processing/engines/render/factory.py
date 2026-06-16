"""Factory for configured score rendering engines."""

from __future__ import annotations

from app.core.config import settings

from .base import ScoreRenderEngine
from .musescore import MuseScoreRenderEngine
from .verovio import VerovioRenderEngine


def create_score_render_engine(
    *,
    output_folder: str,
    timeout_seconds: int | None = None,
    engine_name: str | None = None,
) -> ScoreRenderEngine:
    """Create the configured score rendering engine."""

    selected = (engine_name or settings.SCORE_RENDER_ENGINE).strip().lower()
    if selected == "musescore":
        return MuseScoreRenderEngine(
            output_folder=output_folder,
            timeout_seconds=timeout_seconds,
        )
    if selected == "verovio":
        return VerovioRenderEngine(
            output_folder=output_folder,
            timeout_seconds=timeout_seconds,
        )

    raise ValueError(f"Unsupported score render engine: {selected}")
