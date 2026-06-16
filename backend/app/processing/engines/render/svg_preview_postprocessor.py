"""SVG post-processing for score previews."""

from __future__ import annotations

import html
import xml.etree.ElementTree as ET
from dataclasses import dataclass


SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)


@dataclass(frozen=True)
class ScoreHeader:
    """Top-of-page score metadata extracted from MusicXML."""

    title: str = ""
    subtitle: str = ""
    composer: str = ""
    lyricist: str = ""


class SvgPreviewPostProcessor:
    """Apply NoteVerse preview-only visual adjustments to Verovio SVG output."""

    TITLE_Y = "1600"
    SUBTITLE_Y = "2080"
    LYRICIST_Y = "2750"
    COMPOSER_Y = "3150"

    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled

    def process(self, *, svg: str, xml_path: str, page_number: int) -> str:
        """Return a display-optimized SVG without mutating MusicXML."""

        if not self.enabled or page_number != 1:
            return svg

        header = self._extract_header(xml_path)
        if not any((header.title, header.subtitle, header.composer, header.lyricist)):
            return svg

        try:
            root = ET.fromstring(svg)
        except ET.ParseError:
            return svg

        definition_svg = self._find_definition_svg(root)
        if definition_svg is None:
            return svg

        self._remove_verovio_page_header(definition_svg)
        self._insert_noteverse_header(definition_svg, header)
        return ET.tostring(root, encoding="unicode")

    def _extract_header(self, xml_path: str) -> ScoreHeader:
        """Read title and creator metadata from MusicXML."""

        try:
            root = ET.parse(xml_path).getroot()
        except ET.ParseError:
            return ScoreHeader()

        return ScoreHeader(
            title=self._find_text(root, ["work", "work-title"]),
            subtitle=self._find_credit_text(root, "subtitle"),
            composer=self._find_creator_text(root, "composer")
            or self._find_credit_text(root, "composer"),
            lyricist=self._find_creator_text(root, "lyricist")
            or self._find_credit_text(root, "lyricist"),
        )

    def _find_definition_svg(self, root: ET.Element) -> ET.Element | None:
        """Find Verovio's inner drawing SVG with the page viewBox."""

        for element in root.iter():
            if self._local_name(element.tag) != "svg":
                continue
            if element.get("class") == "definition-scale":
                return element
        return None

    def _remove_verovio_page_header(self, definition_svg: ET.Element) -> None:
        """Remove Verovio's imported page header group, keeping page music intact."""

        for parent in definition_svg.iter():
            for child in list(parent):
                if child.get("class") == "pgHead":
                    parent.remove(child)

    def _insert_noteverse_header(
        self,
        definition_svg: ET.Element,
        header: ScoreHeader,
    ) -> None:
        """Insert a stable title layer in absolute page coordinates."""

        group = ET.Element(f"{{{SVG_NS}}}g")
        group.set("data-nv-score-header", "true")
        group.set("font-family", "Arial, 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif")
        group.set("fill", "black")

        self._append_text(
            group,
            text=header.title,
            x="10500",
            y=self.TITLE_Y,
            anchor="middle",
            size="760",
            weight="700",
        )
        self._append_text(
            group,
            text=header.subtitle,
            x="10500",
            y=self.SUBTITLE_Y,
            anchor="middle",
            size="430",
            weight="400",
        )
        self._append_text(
            group,
            text=header.lyricist,
            x="19500",
            y=self.LYRICIST_Y,
            anchor="end",
            size="330",
            weight="400",
        )
        self._append_text(
            group,
            text=header.composer,
            x="19500",
            y=self.COMPOSER_Y,
            anchor="end",
            size="330",
            weight="400",
        )

        definition_svg.insert(0, group)

    def _append_text(
        self,
        parent: ET.Element,
        *,
        text: str,
        x: str,
        y: str,
        anchor: str,
        size: str,
        weight: str,
    ) -> None:
        """Append one SVG text node when the value exists."""

        value = text.strip()
        if not value:
            return

        element = ET.SubElement(parent, f"{{{SVG_NS}}}text")
        element.set("x", x)
        element.set("y", y)
        element.set("text-anchor", anchor)
        element.set("font-size", size)
        element.set("font-weight", weight)
        element.text = html.unescape(value)

    def _find_text(self, root: ET.Element, path: list[str]) -> str:
        """Find nested text by local tag names."""

        current: ET.Element | None = root
        for name in path:
            if current is None:
                return ""
            current = self._find_child(current, name)
        return (current.text or "").strip() if current is not None else ""

    def _find_creator_text(self, root: ET.Element, creator_type: str) -> str:
        """Find an identification creator by type."""

        identification = self._find_child(root, "identification")
        if identification is None:
            return ""

        for child in identification:
            if self._local_name(child.tag) != "creator":
                continue
            if child.get("type") == creator_type:
                return (child.text or "").strip()
        return ""

    def _find_credit_text(self, root: ET.Element, credit_type: str) -> str:
        """Find a top-level MusicXML credit by credit-type."""

        for credit in root:
            if self._local_name(credit.tag) != "credit":
                continue
            if self._find_text(credit, ["credit-type"]) != credit_type:
                continue
            credit_words = self._find_child(credit, "credit-words")
            if credit_words is not None:
                return (credit_words.text or "").strip()
        return ""

    def _find_child(self, element: ET.Element, name: str) -> ET.Element | None:
        """Find the first direct child by local tag name."""

        for child in element:
            if self._local_name(child.tag) == name:
                return child
        return None

    def _local_name(self, tag: str) -> str:
        """Return the local name for a possibly namespaced XML tag."""

        return tag.rsplit("}", 1)[-1]
