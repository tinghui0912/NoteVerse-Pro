"""Startup-time environment preparation and runtime checks."""

from pathlib import Path

from app.core.config import settings
from app.core.logger import logger


def ensure_runtime_directories() -> None:
    """Create required runtime directories if they do not exist yet."""
    for raw_path in (
        settings.UPLOAD_FOLDER,
        settings.OUTPUT_FOLDER,
        settings.TEMP_FOLDER,
    ):
        path = Path(raw_path)
        if path.exists():
            continue

        path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Created runtime directory: {path}")


def log_external_tool_status() -> None:
    """Log whether configured external executables are currently available."""
    tools = {
        "Audiveris": settings.AUDIVERIS_PATH,
        "MuseScore": settings.MUSESCORE_PATH,
    }

    for tool_name, tool_path in tools.items():
        if Path(tool_path).exists():
            logger.info(f"{tool_name} available: {tool_path}")
        else:
            logger.warning(f"{tool_name} executable not found: {tool_path}")
