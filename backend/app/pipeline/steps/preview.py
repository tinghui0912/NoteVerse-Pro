"""Preview-image generation step."""

import os

from celery.utils.log import get_task_logger

from app.core.exceptions import (
    ScoreRenderFailedException,
    TimeoutException,
)
from app.shared.constants import ErrorCode

from ..base import Step
from ..context import TaskContext

logger = get_task_logger(__name__)


class PreviewGenerationStep(Step):
    """Render one or more preview images from the current MusicXML file."""

    name = "preview_generation"
    progress_start = 90
    progress_end = 98

    def run(self, ctx: TaskContext) -> None:
        from app.processing.engines.render import create_score_render_engine

        main_xml = ctx.main_xml
        if not main_xml or not os.path.exists(main_xml):
            raise ScoreRenderFailedException(details={"reason": "xml_not_found"})

        if ctx.remaining() <= 0:
            raise TimeoutException(details={"error": "Task deadline exceeded before preview generation"})

        logger.info(f"[{ctx.task_id}] Starting preview generation")

        engine = create_score_render_engine(
            output_folder=ctx.preview_dir,
            timeout_seconds=ctx.remaining(),
        )

        try:
            result = engine.render_score(
                xml_path=main_xml,
                output_name="preview",
            )

            if not result["success"]:
                failure_result = result
                if failure_result.get("code") == "task_timeout":
                    raise TimeoutException(details={"error": failure_result.get("error")})
                raise ScoreRenderFailedException(
                    code=str(failure_result.get("code") or ErrorCode.SCORE_RENDER_FAILED),
                    details={
                        "engine": failure_result.get("engine"),
                        "error": failure_result.get("error"),
                    },
                )

            preview_images = [file_info["path"] for file_info in result["files"]]

            if preview_images:
                from app.shared.file_kinds import FileKind
                from app.pipeline.files_recorder import replace_files

                replace_files(
                    ctx.task_id,
                    FileKind.PREVIEW_IMAGE,
                    preview_images,
                )
                logger.info(f"[{ctx.task_id}] Recorded {len(preview_images)} preview images")

            logger.info(f"[{ctx.task_id}] Preview generation completed: {preview_images}")
        except ScoreRenderFailedException:
            raise
        except Exception as exc:
            logger.error(f"[{ctx.task_id}] Preview generation failed: {exc}")
            raise ScoreRenderFailedException(details={"error": str(exc)})
