"""Application lifespan hooks."""

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.core.logger import logger
from app.core.runtime_checks import RuntimeRole
from app.core.startup_checks import ensure_runtime_directories, log_external_tool_status


def create_app_lifespan(
    role: RuntimeRole,
) -> Callable[[FastAPI], AbstractAsyncContextManager[dict[str, object]]]:
    """Create role-aware startup and shutdown hooks for FastAPI services."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[dict[str, object]]:
        logger.bind(
            event="app.starting",
            project_name=settings.PROJECT_NAME,
            app_version="2.0.0",
            environment="development" if settings.DEBUG else "production",
            api_docs_path="/docs",
            runtime_role=role.value,
        ).info("Application starting")
        ensure_runtime_directories()
        log_external_tool_status(role)

        state: dict[str, object] = {}
        hub = None
        if role is RuntimeRole.API:
            from app.modules.realtime.wakeup import RealtimeWakeupHub

            hub = RealtimeWakeupHub()
            await hub.start()
            state["realtime_wakeup_hub"] = hub
        try:
            yield state
        finally:
            if hub is not None:
                await hub.stop()
            logger.bind(
                event="app.stopping",
                project_name=settings.PROJECT_NAME,
                app_version="2.0.0",
                runtime_role=role.value,
            ).info("Application stopping")

    return lifespan


app_lifespan = create_app_lifespan(RuntimeRole.API)
