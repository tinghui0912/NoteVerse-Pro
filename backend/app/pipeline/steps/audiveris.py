"""Audiveris OCR steps for image and PDF inputs."""

from typing import cast

from celery.utils.log import get_task_logger

from app.core.config import settings
from app.core.exceptions import (
    AudiverisFailedException,
    AudiverisMissingException,
    FileNotFoundException,
    TimeoutException,
)
from app.processing.engines.audiveris import AudiverisFailureResult

from ..base import Step
from ..context import TaskContext

logger = get_task_logger(__name__)


def _raise_from_result(result: AudiverisFailureResult) -> None:
    """Translate engine errors into domain exceptions."""
    error_code = result["code"]
    error_detail = result["error"]

    if error_code == "audiveris_missing":
        raise AudiverisMissingException(details={"error": error_detail})
    if error_code == "task_timeout":
        raise TimeoutException(details={"error": error_detail})
    if error_code == "file_not_found":
        raise FileNotFoundException(details={"error": error_detail})
    raise AudiverisFailedException(details={"error": error_detail})


class AudiverisImageStep(Step):
    """Run Audiveris on a single source image."""

    name = "ocr"
    progress_start = 8
    progress_end = 65

    def run(self, ctx: TaskContext) -> None:
        from app.processing.engines.audiveris import (
            AudiverisEngine,
            AudiverisFailureResult,
            AudiverisSuccessResult,
        )

        logger.info(f"[{ctx.task_id}] Starting Audiveris image processing")

        if ctx.remaining() <= 0:
            raise TimeoutException()

        engine = AudiverisEngine(
            audiveris_path=settings.AUDIVERIS_PATH,
            output_folder=ctx.aud_dir,
            timeout_seconds=ctx.remaining(),
        )

        result = engine.process_image(ctx.raw_paths[0])
        if not result.get("success"):
            _raise_from_result(cast(AudiverisFailureResult, result))

        ctx.aud_result = cast(AudiverisSuccessResult, result)
        logger.info(f"[{ctx.task_id}] Audiveris image processing completed")


class AudiverisPdfStep(Step):
    """Run Audiveris on a generated PDF."""

    name = "ocr"
    progress_start = 8
    progress_end = 65

    def run(self, ctx: TaskContext) -> None:
        from app.processing.engines.audiveris import (
            AudiverisEngine,
            AudiverisFailureResult,
            AudiverisSuccessResult,
        )

        logger.info(f"[{ctx.task_id}] Starting Audiveris PDF processing")
        pdf_path = ctx.pdf_path
        if not pdf_path:
            raise FileNotFoundException(details={"error": "PDF input path is missing"})

        if ctx.remaining() <= 0:
            raise TimeoutException()

        engine = AudiverisEngine(
            audiveris_path=settings.AUDIVERIS_PATH,
            output_folder=ctx.aud_dir,
            timeout_seconds=ctx.remaining(),
        )

        result = engine.process_pdf(pdf_path)
        if not result.get("success"):
            _raise_from_result(cast(AudiverisFailureResult, result))

        success_result = cast(AudiverisSuccessResult, result)
        ctx.aud_result = success_result
        logger.info(
            f"[{ctx.task_id}] Audiveris PDF processing completed: "
            f"{success_result['files']['mxl']}"
        )
