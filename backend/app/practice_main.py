"""FastAPI entrypoint for the realtime practice service."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.metrics import router as metrics_router
from app.core.config import settings
from app.core.exception_handlers import register_exception_handlers
from app.core.lifespan import app_lifespan
from app.core.logging_setup import configure_uvicorn_logging
from app.core.middleware import CsrfProtectionMiddleware, LoggingMiddleware
from app.core.tracing import configure_api_tracing
from app.modules.practice.router import router as practice_router


configure_uvicorn_logging()


def _cors_origins() -> list[str]:
    return [str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS]


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.PROJECT_NAME} Practice Service",
        description=f"{settings.PROJECT_NAME} realtime practice API",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url=f"{settings.API_V1_STR}/practice/openapi.json",
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

    app.include_router(practice_router, prefix=f"{settings.API_V1_STR}/practice", tags=["Practice"])
    app.include_router(health_router)
    app.include_router(metrics_router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "message": f"Welcome to {settings.PROJECT_NAME} Practice Service",
            "version": "2.0.0",
            "status": "operational",
        }

    return app


app = create_app()
