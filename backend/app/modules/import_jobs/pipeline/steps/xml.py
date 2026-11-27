"""XML preparation step."""

from app.core.logger import logger

from ..base import Step
from ..context import JobContext


class ExtractXmlStep(Step):
    """Extract or locate the main MusicXML file from OMR output."""

    name = "prepare_xml"
    progress_start = 65
    progress_end = 70

    def run(self, ctx: JobContext) -> None:
        logger.bind(
            event="import_pipeline.xml_preparation_started",
            job_id=ctx.job_id,
        ).info("XML preparation started")

        if not ctx.omr_result:
            raise RuntimeError("OMR processing failed")

        files_dict = ctx.omr_result["files"]
        main_xml = files_dict.get("xml")

        if not main_xml:
            raise RuntimeError("OMR processing failed")

        ctx.main_xml = main_xml
        logger.bind(
            event="import_pipeline.xml_preparation_completed",
            job_id=ctx.job_id,
            musicxml_path=main_xml,
        ).info("XML preparation completed")
