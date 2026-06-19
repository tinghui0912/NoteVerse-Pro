"""Canonicalization helpers for renderer-friendly MusicXML."""

from __future__ import annotations

from pathlib import Path
import xml.etree.ElementTree as ET


def normalize_initial_musicxml_clefs(xml_path: str | Path) -> None:
    """Move initial staff clefs into the first measure's opening attributes.

    Some ABC-to-MusicXML converters emit secondary staff clefs after a `<backup>`
    in the first measure. Tolerant readers may move that clef to the system
    start, while stricter renderers can preserve the late encoded position
    unless the first measure is normalized.
    """

    path = Path(xml_path)
    tree = ET.parse(path)
    root = tree.getroot()
    first_measure = root.find("./part/measure")
    if first_measure is None:
        return

    opening_attributes = first_measure.find("attributes")
    if opening_attributes is None:
        opening_attributes = ET.Element("attributes")
        first_measure.insert(0, opening_attributes)

    opening_clef_numbers = {
        clef.get("number", "1") for clef in opening_attributes.findall("clef")
    }
    changed = False

    for attributes in list(first_measure.findall("attributes"))[1:]:
        for clef in list(attributes.findall("clef")):
            number = clef.get("number", "1")
            if number in opening_clef_numbers:
                continue
            attributes.remove(clef)
            opening_attributes.append(clef)
            opening_clef_numbers.add(number)
            changed = True

        if len(list(attributes)) == 0:
            first_measure.remove(attributes)
            changed = True

    if changed:
        _indent_xml(root)
        tree.write(path, encoding="utf-8", xml_declaration=True)


def _indent_xml(element: ET.Element, level: int = 0) -> None:
    indent = "\n" + level * "  "
    if len(element):
        if not element.text or not element.text.strip():
            element.text = indent + "  "
        for child in element:
            _indent_xml(child, level + 1)
        if not child.tail or not child.tail.strip():
            child.tail = indent
    if level and (not element.tail or not element.tail.strip()):
        element.tail = indent
