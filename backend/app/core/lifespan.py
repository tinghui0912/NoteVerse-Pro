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

    logger.bind(
        event="app.starting",
        project_name=settings.PROJECT_NAME,
        app_version="2.0.0",
        environment="development" if settings.DEBUG else "production",
        api_docs_path="/docs",
    ).info("Application starting")
    ensure_runtime_directories()
    log_external_tool_status()

    try:
        yield
    finally:
        logger.bind(
            event="app.stopping",
            project_name=settings.PROJECT_NAME,
            app_version="2.0.0",
        ).info("Application stopping")
