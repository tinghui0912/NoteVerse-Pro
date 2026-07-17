"""Logging setup helpers for application startup."""

import logging
from typing import Union

from app.core.logger import logger


class InterceptHandler(logging.Handler):
    """Forward standard-library logs into loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        level: Union[str, int]
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame = logging.currentframe()
        depth = 2
        while frame is not None and frame.f_code.co_filename == logging.__file__:
            next_frame = frame.f_back
            if next_frame is None:
                break
            frame = next_frame
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def configure_standard_logging(level: int = logging.INFO) -> None:
    """Route standard-library loggers through the shared loguru logger."""

    root_logger = logging.getLogger()
    root_logger.handlers = [InterceptHandler()]
    root_logger.setLevel(level)


def configure_named_logging(*logger_names: str, level: int = logging.INFO) -> None:
    """Route named standard-library loggers through the shared loguru logger."""

    for log_name in logger_names:
        named_logger = logging.getLogger(log_name)
        named_logger.handlers = [InterceptHandler()]
        named_logger.setLevel(level)
        named_logger.propagate = False


def configure_uvicorn_logging() -> None:
    """Route uvicorn loggers through the shared loguru logger."""

    configure_named_logging("uvicorn", "uvicorn.error", "uvicorn.access")


def configure_celery_logging() -> None:
    """Route Celery framework logs through the shared loguru logger."""

    configure_standard_logging()
    configure_named_logging(
        "celery",
        "celery.app.trace",
        "celery.worker",
        "celery.beat",
        "celery.redirected",
        "kombu",
    )
