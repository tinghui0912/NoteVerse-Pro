"""Factory for configured OMR engines."""

from __future__ import annotations

from .base import OmrEngine
from .legato import LegatoOmrEngine
from .legato_manifest import OMR_ENGINE_NAME


def create_omr_engine(
    *,
    output_folder: str,
    timeout_seconds: int,
    engine_name: str | None = None,
) -> OmrEngine:
    """Create the configured OMR engine."""

    selected = (engine_name or OMR_ENGINE_NAME).lower()
    if selected == OMR_ENGINE_NAME:
        return LegatoOmrEngine(
            output_folder=output_folder,
            timeout_seconds=timeout_seconds,
        )

    raise ValueError(f"Unsupported OMR engine: {selected}")
