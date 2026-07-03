"""Integrate OCR-classified text into a MusicXML document."""

import traceback
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional, TypedDict

from celery.utils.log import get_task_logger

from .text_config import XmlLayoutConfig
from .text_recognition import ClassifiedTexts, OtherTextInfo

logger = get_task_logger(__name__)


class AuthorInfo(TypedDict):
    composer: str
    lyricist: str


class TextIntegrationSuccessResult(TypedDict):
    success: bool
    output_file: str
    text_count: int


class TextIntegrationFailureResult(TypedDict):
    success: bool
    error: str


def _empty_classified_texts() -> ClassifiedTexts:
    """Return a blank classified-text payload for best-effort integration."""
    return {
        "title": None,
        "subtitle": None,
        "composer": None,
        "lyricist": None,
        "copyright": None,
        "other_texts": [],
    }


class TextIntegrationEngine:
    """Write recognized title, creator, and copyright info into MusicXML."""

    def integrate_text_with_existing_info(
        self,
        musicxml_path: str,
        text_info: ClassifiedTexts,
        output_path: Optional[str] = None,
    ) -> TextIntegrationSuccessResult | TextIntegrationFailureResult:
        """Integrate already-classified OCR metadata into a MusicXML file."""
        try:
            logger.info(f"Starting text integration into MusicXML: {musicxml_path}")

            if not text_info:
                logger.warning("text_info is empty; enhanced XML will still be generated")
                text_info = _empty_classified_texts()

            if not isinstance(text_info, dict):
                logger.error(
                    f"Invalid text_info type; expected dict, got {type(text_info)}. Resetting to empty dict"
                )
                text_info = _empty_classified_texts()

            tree = ET.parse(musicxml_path)
            root = tree.getroot()
            texts = text_info.get("other_texts", [])

            try:
                self._add_standard_title_info(root, texts, text_info)
            except Exception as exc:
                logger.error(f"Text info integration failed: {exc}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                raise

            try:
                output_file = output_path or self._default_enhanced_output_path(musicxml_path)
                tree.write(output_file, encoding="utf-8", xml_declaration=True)
                logger.info(f"Text integration completed: {output_file}")
            except Exception as exc:
                logger.error(f"Failed to save XML output: {exc}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                raise

            return {
                "success": True,
                "output_file": output_file,
                "text_count": len(texts),
            }
        except Exception as exc:
            logger.error(f"Text integration failed: {str(exc)}")
            return {"success": False, "error": str(exc)}

    @staticmethod
    def _default_enhanced_output_path(musicxml_path: str) -> str:
        """Build a sibling enhanced XML path without mutating the source file."""
        path = Path(musicxml_path)
        if path.suffix.lower() in {".xml", ".musicxml"}:
            return str(path.with_name(f"{path.stem}_enhanced{path.suffix}"))
        return str(path.with_name(f"{path.name}_enhanced.xml"))

    def _add_standard_title_info(
        self,
        root: ET.Element,
        texts: Optional[List[OtherTextInfo]] = None,
        structured_info: Optional[ClassifiedTexts] = None,
    ) -> None:
        """Apply title, creator, and copyright info to the XML tree."""
        if texts is None:
            texts = []
        if structured_info is None:
            structured_info = _empty_classified_texts()

        title_text = (structured_info.get("title", "") or "").strip()
        subtitle_text = (structured_info.get("subtitle", "") or "").strip()
        composer_text = (structured_info.get("composer", "") or "").strip()
        lyricist_text = (structured_info.get("lyricist", "") or "").strip()

        self._update_work_title(root, title_text)
        self._clean_existing_creator_elements(root)
        self._clean_existing_credits(root)

        part_list = root.find("part-list")
        if part_list is not None:
            insert_index = list(root).index(part_list)
            insert_index = self._add_title_credit(root, insert_index, title_text)
            insert_index = self._add_subtitle_credit(root, insert_index, subtitle_text)

            author_info: AuthorInfo = {"composer": composer_text, "lyricist": lyricist_text}
            self._add_author_credits(root, insert_index, author_info)

        self._update_creator_elements(root, composer_text, lyricist_text)

        copyright_text = (structured_info.get("copyright", "") or "").strip()
        self._update_copyright_element(root, copyright_text)
        self._add_copyright_credit(root)

    def _update_work_title(self, root: ET.Element, title_text: str) -> None:
        """Set or update the `<work-title>` element."""
        work = root.find("work")
        if work is None and title_text:
            work = ET.Element("work")
            work_title = ET.SubElement(work, "work-title")
            work_title.text = title_text
            root.insert(0, work)
            logger.info("Added work-title")
        elif work is not None and title_text:
            work_title_element = work.find("work-title")
            if work_title_element is not None:
                work_title_element.text = title_text
                logger.info("Updated work-title")

    def _clean_existing_creator_elements(self, root: ET.Element) -> None:
        """Remove all existing `<creator>` elements before rebuilding them."""
        identification = root.find("identification")
        if identification is not None:
            creators = identification.findall("creator")
            for element in creators:
                identification.remove(element)
            if creators:
                logger.info(f"Removed {len(creators)} creator elements")

    def _clean_existing_credits(self, root: ET.Element) -> None:
        """Remove existing `<credit>` elements before writing the canonical set."""
        credits = root.findall("credit")
        for credit in credits:
            root.remove(credit)
        if credits:
            logger.info(f"Removed {len(credits)} credit elements")

    def _create_credit_element(
        self,
        text: str,
        default_x: str,
        default_y: str,
        justify: str,
        valign: str,
        font_size: Optional[str] = None,
        font_weight: Optional[str] = None,
        credit_type: Optional[str] = None,
    ) -> ET.Element:
        """Create a MusicXML credit element in canonical document order."""
        credit = ET.Element("credit")
        credit.set("page", "1")

        if credit_type:
            credit_type_el = ET.SubElement(credit, "credit-type")
            credit_type_el.text = credit_type

        credit_words = ET.SubElement(credit, "credit-words")
        credit_words.set("default-x", default_x)
        credit_words.set("default-y", default_y)
        credit_words.set("justify", justify)
        credit_words.set("valign", valign)
        if font_size:
            credit_words.set("font-size", font_size)
        if font_weight:
            credit_words.set("font-weight", font_weight)
        credit_words.text = text
        return credit

    def _add_title_credit(self, root: ET.Element, insert_index: int, title_text: str) -> int:
        """Insert the main title credit element."""
        if not title_text:
            return insert_index

        cfg = XmlLayoutConfig.TITLE
        credit = self._create_credit_element(
            text=title_text,
            default_x=XmlLayoutConfig.TITLE_CENTER_X,
            default_y=cfg["default_y"],
            justify=cfg["justify"],
            valign=cfg["valign"],
            font_size=cfg["font_size"],
            font_weight=cfg.get("font_weight"),
            credit_type=cfg["credit_type"],
        )
        root.insert(insert_index, credit)
        return insert_index + 1

    def _add_subtitle_credit(
        self,
        root: ET.Element,
        insert_index: int,
        subtitle_text: str,
    ) -> int:
        """Insert the subtitle credit element."""
        if not subtitle_text:
            return insert_index

        cfg = XmlLayoutConfig.SUBTITLE
        credit = self._create_credit_element(
            text=subtitle_text,
            default_x=XmlLayoutConfig.TITLE_CENTER_X,
            default_y=cfg["default_y"],
            justify=cfg["justify"],
            valign=cfg["valign"],
            font_size=cfg["font_size"],
            credit_type=cfg["credit_type"],
        )
        root.insert(insert_index, credit)
        return insert_index + 1

    def _add_author_credits(
        self,
        root: ET.Element,
        insert_index: int,
        author_info: AuthorInfo,
    ) -> None:
        """Insert composer and lyricist credits."""
        if author_info.get("composer"):
            cfg = XmlLayoutConfig.COMPOSER_INFO
            credit = self._create_credit_element(
                text=author_info["composer"],
                default_x=cfg["default_x"],
                default_y=cfg["default_y"],
                justify=cfg["justify"],
                valign=cfg["valign"],
                credit_type="composer",
            )
            root.insert(insert_index, credit)
            insert_index += 1

        if author_info.get("lyricist"):
            cfg = XmlLayoutConfig.LYRICIST_INFO
            credit = self._create_credit_element(
                text=author_info["lyricist"],
                default_x=cfg["default_x"],
                default_y=cfg["default_y"],
                justify=cfg["justify"],
                valign=cfg["valign"],
                credit_type="lyricist",
            )
            root.insert(insert_index, credit)

    def _update_creator_elements(
        self,
        root: ET.Element,
        composer_text: str,
        lyricist_text: str,
    ) -> None:
        """Rebuild `<creator>` elements in canonical MusicXML order."""
        identification = root.find("identification")
        if identification is None:
            identification = ET.SubElement(root, "identification")

        insert_pos = 0
        if lyricist_text:
            creator = ET.Element("creator")
            creator.set("type", "lyricist")
            creator.text = lyricist_text
            identification.insert(insert_pos, creator)

        if composer_text:
            creator = ET.Element("creator")
            creator.set("type", "composer")
            creator.text = composer_text
            identification.insert(0, creator)

    def _update_copyright_element(self, root: ET.Element, copyright_text: str) -> None:
        """Set or update the `<rights>` element."""
        if not copyright_text:
            return

        identification = root.find("identification")
        if identification is None:
            identification = ET.SubElement(root, "identification")

        rights = identification.find("rights")
        if rights is None:
            rights = ET.SubElement(identification, "rights")
            rights.text = copyright_text
        else:
            rights.text = copyright_text

    def _add_copyright_credit(self, root: ET.Element) -> None:
        """Insert a copyright credit before `<part-list>`."""
        identification = root.find("identification")
        if identification is None:
            return

        rights = identification.find("rights")
        if rights is None or not (rights.text or "").strip():
            return

        copyright_text = (rights.text or "").strip()
        cfg = XmlLayoutConfig.COPYRIGHT
        credit = self._create_multiline_credit_element(
            text=copyright_text,
            default_x=cfg["default_x"],
            default_y=cfg["default_y"],
            line_spacing=cfg["line_spacing"],
            justify=cfg["justify"],
            valign=cfg["valign"],
            font_size=cfg["font_size"],
            credit_type=cfg["credit_type"],
        )

        part_list = root.find("part-list")
        if part_list is not None:
            insert_index = list(root).index(part_list)
            root.insert(insert_index, credit)

    def _create_multiline_credit_element(
        self,
        text: str,
        default_x: str,
        default_y: str,
        line_spacing: str,
        justify: str,
        valign: str,
        font_size: str,
        credit_type: str,
    ) -> ET.Element:
        """Create one MusicXML credit with one credit-word per rendered line."""
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if not lines:
            lines = [text.strip()]

        credit = ET.Element("credit")
        credit.set("page", "1")
        credit_type_el = ET.SubElement(credit, "credit-type")
        credit_type_el.text = credit_type

        base_y = float(default_y)
        spacing = float(line_spacing)
        top_line_y = base_y + spacing * (len(lines) - 1)

        for index, line in enumerate(lines):
            credit_words = ET.SubElement(credit, "credit-words")
            credit_words.set("default-x", default_x)
            credit_words.set("default-y", f"{top_line_y - spacing * index:.6f}")
            credit_words.set("justify", justify)
            credit_words.set("valign", valign)
            credit_words.set("font-size", font_size)
            credit_words.text = line

        return credit
