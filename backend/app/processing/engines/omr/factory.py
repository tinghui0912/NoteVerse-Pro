"""Factory for configured OMR engines."""

from __future__ import annotations

from app.core.config import settings

from .base import OmrEngine
from .legato import LegatoOmrEngine


def create_omr_engine(
    *,
    output_folder: str,
    timeout_seconds: int,
    engine_name: str | None = None,
) -> OmrEngine:
    """Create the configured OMR engine."""

    selected = (engine_name or settings.OMR_ENGINE).lower()
    if selected == "legato":
        return LegatoOmrEngine(
            output_folder=output_folder,
            timeout_seconds=timeout_seconds,
        )

    raise ValueError(f"Unsupported OMR engine: {selected}")
