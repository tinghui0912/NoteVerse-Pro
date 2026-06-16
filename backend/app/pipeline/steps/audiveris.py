"""OMR steps for image and PDF inputs."""

from typing import cast

from celery.utils.log import get_task_logger

from app.core.exceptions import (
    AudiverisFailedException,
    AudiverisMissingException,
    FileNotFoundException,
    LegatoFailedException,
    TimeoutException,
)
from app.processing.engines.omr import OmrFailureResult, OmrSuccessResult, create_omr_engine

from ..base import Step
from ..context import TaskContext

logger = get_task_logger(__name__)


def _raise_from_result(result: OmrFailureResult) -> None:
    """Translate engine errors into domain exceptions."""
    error_code = result["code"]
    error_detail = result["error"]

    if error_code == "audiveris_missing":
        raise AudiverisMissingException(details={"error": error_detail})
    if error_code == "task_timeout":
        raise TimeoutException(details={"error": error_detail})
    if error_code == "file_not_found":
        raise FileNotFoundException(details={"error": error_detail})
    if error_code.startswith("legato_"):
        raise LegatoFailedException(
            code=error_code,
            details={"error": error_detail},
        )
    raise AudiverisFailedException(details={"error": error_detail})


class OmrImageStep(Step):
    """Run the configured OMR engine on a single source image."""

    name = "ocr"
    progress_start = 8
    progress_end = 65

    def run(self, ctx: TaskContext) -> None:
        logger.info(f"[{ctx.task_id}] Starting OMR image processing")

        if ctx.remaining() <= 0:
            raise TimeoutException()

        engine = create_omr_engine(
            output_folder=ctx.omr_dir,
            timeout_seconds=ctx.remaining(),
        )

        result = engine.process_image(ctx.raw_paths[0])
        if not result.get("success"):
            _raise_from_result(cast(OmrFailureResult, result))

        ctx.omr_result = cast(OmrSuccessResult, result)
        logger.info(
            f"[{ctx.task_id}] OMR image processing completed via {ctx.omr_result['engine']}"
        )


class OmrPdfStep(Step):
    """Run the configured OMR engine on a generated PDF."""

    name = "ocr"
    progress_start = 8
    progress_end = 65

    def run(self, ctx: TaskContext) -> None:
        logger.info(f"[{ctx.task_id}] Starting OMR PDF processing")
        pdf_path = ctx.pdf_path
        if not pdf_path:
            raise FileNotFoundException(details={"error": "PDF input path is missing"})

        if ctx.remaining() <= 0:
            raise TimeoutException()

        engine = create_omr_engine(
            output_folder=ctx.omr_dir,
            timeout_seconds=ctx.remaining(),
        )

        result = engine.process_pdf(pdf_path)
        if not result.get("success"):
            _raise_from_result(cast(OmrFailureResult, result))

        success_result = cast(OmrSuccessResult, result)
        ctx.omr_result = success_result
        logger.info(
            f"[{ctx.task_id}] OMR PDF processing completed via {success_result['engine']}: "
            f"{success_result['files']['mxl']}"
        )


# Backward-compatible names for tests or imports that have not moved yet.
AudiverisImageStep = OmrImageStep
AudiverisPdfStep = OmrPdfStep
