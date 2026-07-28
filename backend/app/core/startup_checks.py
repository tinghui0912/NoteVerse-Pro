"""Startup-time environment preparation and runtime checks."""

from pathlib import Path

from app.core.config import settings
from app.core.logger import logger
from app.core.runtime_checks import RuntimeRole


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
        logger.bind(
            event="runtime.directory_created",
            path=str(path),
        ).info("Runtime directory created")


def log_external_tool_status(role: RuntimeRole) -> None:
    """Log role-specific runtime tool configuration."""
    if role in {RuntimeRole.WORKER, RuntimeRole.ALL}:
        _log_worker_tool_status()
    if role in {RuntimeRole.PRACTICE, RuntimeRole.ALL}:
        logger.bind(
            event="runtime.practice_alignment_configured",
        ).info("Practice alignment runtime configured")


def _log_worker_tool_status() -> None:
    logger.bind(
        event="runtime.omr_engine_configured",
        engine=settings.OMR_ENGINE,
    ).info("OMR engine configured")
    logger.bind(
        event="runtime.score_render_engine_configured",
        engine=settings.SCORE_RENDER_ENGINE,
    ).info("Score render engine configured")

    if settings.LEGATO_REPO_PATH:
        legato_path = Path(settings.LEGATO_REPO_PATH)
        if legato_path.exists():
            logger.bind(
                event="runtime.legato_repository_available",
                path=str(legato_path),
            ).info("LEGATO repository available")
        else:
            logger.bind(
                event="runtime.legato_repository_missing",
                path=str(legato_path),
            ).warning("LEGATO repository not found")
        logger.bind(
            event="runtime.legato_python_configured",
            path=settings.LEGATO_PYTHON,
        ).info("LEGATO python configured")
        logger.bind(
            event="runtime.legato_model_configured",
            path=settings.LEGATO_MODEL_PATH,
        ).info("LEGATO model configured")
    logger.bind(
        event="runtime.verovio_renderer_selected",
    ).info("Verovio renderer selected")
