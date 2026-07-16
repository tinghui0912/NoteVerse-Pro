"""XML normalization step."""

from __future__ import annotations

import os
import xml.etree.ElementTree as ET

from app.core.logger import logger

from ..base import Step
from ..context import JobContext


class XmlNormalizeStep(Step):
    """Normalize page layout and measure numbering in the enhanced XML."""

    name = "xml_normalize"
    progress_start = 85
    progress_end = 90

    A4_MILLIMETERS = 6.99911
    A4_TENTHS = 40
    A4_PAGE_WIDTH = "1200.48"
    A4_PAGE_HEIGHT = "1696.94"
    A4_MARGIN = "85.7252"

    def run(self, ctx: JobContext) -> None:
        xml_path = ctx.main_xml
        if not xml_path or not os.path.exists(xml_path):
            logger.bind(
                event="import_pipeline.xml_normalization_skipped",
                job_id=ctx.job_id,
                reason="musicxml_missing",
            ).warning("XML normalization skipped")
            return

        logger.bind(
            event="import_pipeline.xml_normalization_started",
            job_id=ctx.job_id,
            musicxml_path=xml_path,
        ).info("XML normalization started")

        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()

            self._force_a4_page_layout(root, ctx.job_id)
            self._fix_measure_numbers(root, ctx.job_id)
            self._save_formatted_xml(tree, xml_path, ctx.job_id)

            logger.bind(
                event="import_pipeline.xml_normalization_completed",
                job_id=ctx.job_id,
                musicxml_path=xml_path,
            ).info("XML normalization completed")
        except Exception as exc:
            logger.bind(
                event="import_pipeline.xml_normalization_failed",
                job_id=ctx.job_id,
                musicxml_path=xml_path,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).warning("XML normalization failed")

    def _force_a4_page_layout(self, root: ET.Element, job_id: str) -> None:
        """Rewrite `<defaults>` layout values to the A4 standard."""
        defaults = root.find("defaults")
        if defaults is None:
            defaults = ET.Element("defaults")
            root.insert(0, defaults)

        scaling = defaults.find("scaling")
        if scaling is None:
            scaling = ET.SubElement(defaults, "scaling")

        mm_elem = scaling.find("millimeters")
        if mm_elem is None:
            mm_elem = ET.SubElement(scaling, "millimeters")
        mm_elem.text = f"{self.A4_MILLIMETERS}"

        tenths_elem = scaling.find("tenths")
        if tenths_elem is None:
            tenths_elem = ET.SubElement(scaling, "tenths")
        tenths_elem.text = str(self.A4_TENTHS)

        page_layout = defaults.find("page-layout")
        if page_layout is None:
            page_layout = ET.SubElement(defaults, "page-layout")

        ph = page_layout.find("page-height")
        if ph is None:
            ph = ET.SubElement(page_layout, "page-height")
        ph.text = str(self.A4_PAGE_HEIGHT)

        pw = page_layout.find("page-width")
        if pw is None:
            pw = ET.SubElement(page_layout, "page-width")
        pw.text = str(self.A4_PAGE_WIDTH)

        for old_pm in page_layout.findall("page-margins"):
            page_layout.remove(old_pm)

        margin_str = f"{self.A4_MARGIN}"
        for margin_type in ("even", "odd"):
            pm = ET.SubElement(page_layout, "page-margins")
            pm.set("type", margin_type)
            for side in ("left-margin", "right-margin", "top-margin", "bottom-margin"):
                elem = ET.SubElement(pm, side)
                elem.text = margin_str

        logger.bind(
            event="import_pipeline.xml_page_layout_applied",
            job_id=job_id,
            page_width=self.A4_PAGE_WIDTH,
            page_height=self.A4_PAGE_HEIGHT,
            margin=self.A4_MARGIN,
        ).info("XML page layout applied")

    def _fix_measure_numbers(self, root: ET.Element, job_id: str) -> None:
        """Normalize measure numbering when the source starts at zero."""
        measures = root.findall(".//measure")
        if not measures:
            logger.bind(
                event="import_pipeline.measure_number_normalization_skipped",
                job_id=job_id,
                reason="no_measures",
            ).info("Measure number normalization skipped")
            return

        measures.sort(key=lambda measure: int(measure.get("number", "0")))

        first_measure_number = int(measures[0].get("number", "0"))
        logger.bind(
            event="import_pipeline.measure_number_detected",
            job_id=job_id,
            first_measure_number=first_measure_number,
            measure_count=len(measures),
        ).info("First measure number detected")

        if first_measure_number == 1:
            logger.bind(
                event="import_pipeline.measure_number_normalization_skipped",
                job_id=job_id,
                reason="already_one_based",
                first_measure_number=first_measure_number,
            ).info("Measure number normalization skipped")
            return
        if first_measure_number == 0:
            logger.bind(
                event="import_pipeline.measure_number_normalization_started",
                job_id=job_id,
                first_measure_number=first_measure_number,
            ).info("Measure number normalization started")
            fixes_made = 0

            for measure in measures:
                old_number = int(measure.get("number", "0"))
                new_number = old_number + 1
                measure.set("number", str(new_number))
                fixes_made += 1

            logger.bind(
                event="import_pipeline.measure_number_normalization_completed",
                job_id=job_id,
                fixes_made=fixes_made,
            ).info("Measure number normalization completed")
            return

        logger.bind(
            event="import_pipeline.measure_number_normalization_skipped",
            job_id=job_id,
            reason="nonstandard_start",
            first_measure_number=first_measure_number,
        ).info("Measure number normalization skipped")

    def _save_formatted_xml(
        self,
        tree: ET.ElementTree[ET.Element],
        output_file: str,
        job_id: str,
    ) -> None:
        """Persist a formatted XML document in place."""
        self._indent_xml(tree.getroot())
        tree.write(
            output_file,
            encoding="utf-8",
            xml_declaration=True,
            short_empty_elements=True,
        )
        logger.bind(
            event="import_pipeline.xml_saved",
            job_id=job_id,
            output_path=output_file,
        ).info("XML output saved")

    def _indent_xml(self, elem, level=0) -> None:
        """Apply indentation and newlines to the XML tree."""
        indent = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = indent + "  "
            if not elem.tail or not elem.tail.strip():
                elem.tail = indent
            for child in elem:
                self._indent_xml(child, level + 1)
            if not child.tail or not child.tail.strip():
                child.tail = indent
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = indent
