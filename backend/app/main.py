"""FastAPI application entrypoint."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.metrics import router as metrics_router
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exception_handlers import register_exception_handlers
from app.core.lifespan import app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CsrfProtectionMiddleware, LoggingMiddleware
from app.core.tracing import configure_api_tracing


configure_uvicorn_logging()


def _cors_origins() -> list[str]:
    return [str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS]


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title=settings.PROJECT_NAME,
        description=f"{settings.PROJECT_NAME} API - Sheet Music Processing System",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        lifespan=app_lifespan,
    )

    app.add_middleware(LoggingMiddleware)
    app.add_middleware(CsrfProtectionMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    configure_api_tracing(app)

    # StaticFiles requires the target directory to exist at mount time.
    os.makedirs(settings.STORAGE_ROOT, exist_ok=True)

    app.mount(
        f"{settings.API_V1_STR}/uploads",
        StaticFiles(directory=settings.STORAGE_ROOT),
        name="uploads",
    )

    app.include_router(api_router, prefix=settings.API_V1_STR)
    app.include_router(health_router)
    app.include_router(metrics_router)

    @app.get("/")
    def root():
        return {
            "message": f"Welcome to {settings.PROJECT_NAME} API",
            "version": "2.0.0",
            "docs": "/docs",
            "status": "operational",
        }

    return app


app = create_app()
