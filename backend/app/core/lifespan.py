"""Application lifespan hooks."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.core.logger import logger
from app.core.startup_checks import ensure_runtime_directories, log_external_tool_status


@asynccontextmanager
async def app_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run startup and shutdown logging for the FastAPI application."""

    logger.info("=" * 60)
    logger.info(f"Starting {settings.PROJECT_NAME}")
    logger.info("Version: 2.0.0")
    logger.info(f"Environment: {'development' if settings.DEBUG else 'production'}")
    logger.info("API docs: http://localhost:8000/docs")
    logger.info("=" * 60)
    ensure_runtime_directories()
    log_external_tool_status()

    try:
        yield
    finally:
        logger.info("=" * 60)
        logger.info(f"Stopping {settings.PROJECT_NAME}")
        logger.info("=" * 60)
