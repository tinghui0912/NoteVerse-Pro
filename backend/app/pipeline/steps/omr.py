"""OMR pipeline step for ordered score image pages."""

from typing import cast

from celery.utils.log import get_task_logger

from app.core.exceptions import FileNotFoundException, OmrFailedException, TimeoutException
from app.processing.engines.omr import OmrFailureResult, OmrSuccessResult, create_omr_engine

from ..base import Step
from ..context import JobContext

logger = get_task_logger(__name__)


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
        logger.info(f"[{ctx.job_id}] Starting OMR processing for {len(ctx.raw_paths)} page(s)")

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
        logger.info(
            f"[{ctx.job_id}] OMR processing completed via {ctx.omr_result['engine']}"
        )
