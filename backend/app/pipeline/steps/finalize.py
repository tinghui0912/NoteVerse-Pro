"""Final pipeline step for editor-facing XML output."""

import os
import shutil

from celery.utils.log import get_task_logger

from app.shared.file_kinds import FileKind

from ..base import Step
from ..context import JobContext

logger = get_task_logger(__name__)


class FinalizeStep(Step):
    """Record the normalized MusicXML processing artifact."""

    name = "finalize"
    progress_start = 98
    progress_end = 99

    def run(self, ctx: JobContext) -> None:
        main_xml = ctx.main_xml
        if not main_xml or not os.path.exists(main_xml):
            logger.warning(f"[{ctx.job_id}] XML file not found; skipping normalized artifact")
            return

        from app.pipeline.files_recorder import replace_files

        xml_dir = os.path.dirname(main_xml)
        normalized_path = os.path.join(xml_dir, "normalized.musicxml")
        shutil.copy2(main_xml, normalized_path)
        replace_files(
            ctx.job_id,
            FileKind.NORMALIZED_MUSICXML,
            [os.path.abspath(normalized_path)],
        )
        logger.info(f"[{ctx.job_id}] Recorded normalized MusicXML: {normalized_path}")
