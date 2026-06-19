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

    if settings.LEGATO_REPO_PATH:
        legato_path = Path(settings.LEGATO_REPO_PATH)
        if legato_path.exists():
            logger.info(f"LEGATO repository available: {legato_path}")
        else:
            logger.warning(f"LEGATO repository not found: {legato_path}")
        logger.info(f"LEGATO python: {settings.LEGATO_PYTHON}")
        logger.info(f"LEGATO model: {settings.LEGATO_MODEL_PATH}")
    logger.info("Verovio renderer selected; Python package availability is checked at render time")
