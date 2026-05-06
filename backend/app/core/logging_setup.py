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


def configure_uvicorn_logging() -> None:
    """Route uvicorn loggers through the shared loguru logger."""

    for log_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(log_name)
        uvicorn_logger.handlers = [InterceptHandler()]
        uvicorn_logger.propagate = False
