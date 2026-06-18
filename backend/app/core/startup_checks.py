"""Startup-time environment preparation and runtime checks."""

from pathlib import Path

from app.core.config import settings
from app.core.logger import logger


def ensure_runtime_directories() -> None:
    """Create required runtime directories if they do not exist yet."""
    for raw_path in (
        settings.STORAGE_ROOT,
        settings.WORK_ROOT,
    ):
        path = Path(raw_path)
        if path.exists():
            continue

        path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Created runtime directory: {path}")


def log_external_tool_status() -> None:
    """Log whether configured external executables are currently available."""
    logger.info(f"Configured OMR engine: {settings.OMR_ENGINE}")
    logger.info(f"Configured score render engine: {settings.SCORE_RENDER_ENGINE}")

    tools = {}
    if settings.SCORE_RENDER_ENGINE == "musescore":
        tools["MuseScore"] = settings.MUSESCORE_PATH
    if settings.OMR_ENGINE == "audiveris":
        tools["Audiveris"] = settings.AUDIVERIS_PATH
    elif settings.OMR_ENGINE == "legato" and settings.LEGATO_REPO_PATH:
        legato_path = Path(settings.LEGATO_REPO_PATH)
        if legato_path.exists():
            logger.info(f"LEGATO repository available: {legato_path}")
        else:
            logger.warning(f"LEGATO repository not found: {legato_path}")
        logger.info(f"LEGATO python: {settings.LEGATO_PYTHON}")
        logger.info(f"LEGATO model: {settings.LEGATO_MODEL_PATH}")
    if settings.SCORE_RENDER_ENGINE == "verovio":
        logger.info("Verovio renderer selected; Python package availability is checked at render time")

    for tool_name, tool_path in tools.items():
        if not tool_path:
            logger.warning(f"{tool_name} executable is not configured")
            continue
        if Path(tool_path).exists():
            logger.info(f"{tool_name} available: {tool_path}")
        else:
            logger.warning(f"{tool_name} executable not found: {tool_path}")
