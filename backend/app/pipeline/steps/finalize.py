"""Final pipeline step for editor-facing XML output."""

import os
import shutil

from celery.utils.log import get_task_logger

from app.shared.file_kinds import FileKind

from ..base import Step
from ..context import TaskContext

logger = get_task_logger(__name__)


class FinalizeStep(Step):
    """Create the current editor XML artifact at the end of the pipeline."""

    name = "finalize"
    progress_start = 98
    progress_end = 99

    def run(self, ctx: TaskContext) -> None:
        main_xml = ctx.main_xml
        if not main_xml or not os.path.exists(main_xml):
            logger.warning(f"[{ctx.task_id}] XML file not found; skipping current_xml creation")
            return

        try:
            from app.pipeline.files_recorder import replace_files

            xml_dir = os.path.dirname(main_xml)
            current_path = os.path.join(xml_dir, "current.xml")
            shutil.copy2(main_xml, current_path)
            replace_files(ctx.task_id, FileKind.CURRENT_XML, [os.path.abspath(current_path)])
            logger.info(f"[{ctx.task_id}] Created current_xml: {current_path}")
        except Exception as exc:
            logger.warning(f"[{ctx.task_id}] Failed to create current_xml: {exc}")
