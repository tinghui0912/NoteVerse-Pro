"""Stable MusicXML ids for practice render and target mapping."""

from __future__ import annotations

from collections.abc import Iterator
import re
from app.platform.document_admission.musicxml import parse_musicxml
import xml.etree.ElementTree as ET


APP_ID_PREFIX = "nv"
XML_ID_START = re.compile(r"[A-Za-z_]")
XML_ID_BODY = re.compile(r"[A-Za-z0-9_.-]")


def prepare_musicxml_ids_for_practice(xml: str) -> str:
    root = parse_musicxml(xml)
    used_ids: set[str] = set()
    changed = False

    for part_index, part in enumerate(_direct_children_by_local_name(root, "part"), start=1):
        for measure_index, measure in enumerate(
            _direct_children_by_local_name(part, "measure"),
            start=1,
        ):
            selectable_index = 0
            for element in list(measure):
                tag = _local_name(element.tag)
                if tag not in {"note", "forward"}:
                    continue
                selectable_index += 1
                existing = element.get("id")
                sanitized_existing = _sanitize_xml_id(existing) if existing else ""
                can_keep_existing = (
                    bool(existing) and sanitized_existing == existing and existing not in used_ids
                )
                if can_keep_existing and existing is not None:
                    next_id = existing
                else:
                    base_id = (
                        sanitized_existing
                        or f"{APP_ID_PREFIX}-p{part_index}-m{measure_index}-{tag}{selectable_index}"
                    )
                    next_id = _create_unique_musicxml_id(base_id, used_ids)
                    element.set("id", next_id)
                    changed = True
                used_ids.add(next_id)

    return _serialize(root) if changed else xml


def _direct_children_by_local_name(element: ET.Element, name: str) -> Iterator[ET.Element]:
    for child in list(element):
        if _local_name(child.tag) == name:
            yield child


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _sanitize_xml_id(value: str) -> str:
    result = "".join(char if XML_ID_BODY.fullmatch(char) else "-" for char in value.strip())
    if not result or not XML_ID_START.fullmatch(result[0]):
        result = f"{APP_ID_PREFIX}-{result or 'entity'}"
    return result


def _create_unique_musicxml_id(base_id: str, used_ids: set[str]) -> str:
    sanitized = _sanitize_xml_id(base_id)
    if sanitized not in used_ids:
        return sanitized
    suffix = 2
    while f"{sanitized}-{suffix}" in used_ids:
        suffix += 1
    return f"{sanitized}-{suffix}"


def _serialize(root: ET.Element) -> str:
    return ET.tostring(root, encoding="unicode")
