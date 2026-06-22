"""XML preparation step."""

import os
from typing import cast

from celery.utils.log import get_task_logger

from ..base import Step
from ..context import JobContext

logger = get_task_logger(__name__)


class ExtractXmlStep(Step):
    """Extract or locate the main MusicXML file from OMR output."""

    name = "prepare_xml"
    progress_start = 65
    progress_end = 70

    def run(self, ctx: JobContext) -> None:
        logger.info(f"[{ctx.job_id}] Starting XML preparation")

        if not ctx.omr_result:
            raise RuntimeError("OMR processing failed")

        files_dict = ctx.omr_result["files"]
        main_xml = files_dict.get("xml")
        mxl_path = files_dict.get("mxl")

        if not main_xml and mxl_path and os.path.exists(mxl_path):
            from app.processing.extractors.mxl import MXLExtractAllSuccessResult, MXLExtractor

            mx_result = MXLExtractor().extract_all_xml(mxl_path, ctx.xml_dir)
            if mx_result.get("success"):
                success_result = cast(MXLExtractAllSuccessResult, mx_result)
                main_xml = success_result["main_xml"]

        if not main_xml:
            raise RuntimeError("OMR processing failed")

        ctx.main_xml = main_xml
        logger.info(f"[{ctx.job_id}] XML preparation completed: {main_xml}")
