"""FastAPI application entrypoint."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exception_handlers import register_exception_handlers
from app.core.lifespan import app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import LoggingMiddleware


configure_uvicorn_logging()


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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    # StaticFiles requires the target directory to exist at mount time.
    os.makedirs(settings.UPLOAD_FOLDER, exist_ok=True)

    app.mount(
        f"{settings.API_V1_STR}/uploads",
        StaticFiles(directory=settings.UPLOAD_FOLDER),
        name="uploads",
    )

    app.include_router(api_router, prefix=settings.API_V1_STR)

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
