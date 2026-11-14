"""OMR pipeline step for ordered score image pages."""

from typing import cast

from app.core.exceptions import FileNotFoundException, OmrFailedException, TimeoutException
from app.core.logger import logger
from app.processing.engines.omr import OmrFailureResult, OmrSuccessResult, create_omr_engine

from ..base import Step
from ..context import JobContext


def _raise_from_result(result: OmrFailureResult) -> None:
    """Translate a generic engine failure into a pipeline exception."""
    error_code = result["code"]
    details = {
        "engine": result["engine"],
        "error": result["error"],
    }

    if error_code == "task_timeout":
        raise TimeoutException(details=details)
    if error_code == "file_not_found":
        raise FileNotFoundException(details=details)
    raise OmrFailedException(code=error_code, details=details)


class OmrStep(Step):
    """Run the configured OMR engine on ordered source image pages."""

    name = "ocr"
    progress_start = 8
    progress_end = 65

    def run(self, ctx: JobContext) -> None:
        logger.bind(
            event="import_pipeline.omr_started",
            job_id=ctx.job_id,
            page_count=len(ctx.raw_paths),
        ).info("OMR processing started")

        if not ctx.raw_paths:
            raise FileNotFoundException(details={"error": "No score image pages are available"})
        if ctx.remaining() <= 0:
            raise TimeoutException()

        engine = create_omr_engine(
            output_folder=ctx.omr_dir,
            timeout_seconds=ctx.remaining(),
        )
        result = engine.process_images(ctx.raw_paths)
        if not result.get("success"):
            _raise_from_result(cast(OmrFailureResult, result))

        ctx.omr_result = cast(OmrSuccessResult, result)
        logger.bind(
            event="import_pipeline.omr_completed",
            job_id=ctx.job_id,
            engine=ctx.omr_result["engine"],
            page_count=len(ctx.raw_paths),
        ).info("OMR processing completed")
