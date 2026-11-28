"""Streaming XML resource validation precedes every ElementTree construction."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
import codecs
from dataclasses import dataclass, fields
from enum import StrEnum
from pathlib import Path
from typing import BinaryIO, NoReturn
import xml.etree.ElementTree as ET
from xml.parsers import expat


class AdmissionReason(StrEnum):
    SIZE_EXCEEDED = "SIZE_EXCEEDED"
    DEPTH_EXCEEDED = "DEPTH_EXCEEDED"
    ELEMENT_COUNT_EXCEEDED = "ELEMENT_COUNT_EXCEEDED"
    ATTRIBUTES_EXCEEDED = "ATTRIBUTES_EXCEEDED"
    ATTRIBUTE_VALUE_EXCEEDED = "ATTRIBUTE_VALUE_EXCEEDED"
    TEXT_EXCEEDED = "TEXT_EXCEEDED"
    DTD_OR_ENTITY_FORBIDDEN = "DTD_OR_ENTITY_FORBIDDEN"
    PROCESSING_INSTRUCTION_FORBIDDEN = "PROCESSING_INSTRUCTION_FORBIDDEN"
    MALFORMED_XML = "MALFORMED_XML"
    UNSUPPORTED_ROOT = "UNSUPPORTED_ROOT"


class DocumentAdmissionError(ValueError):
    def __init__(self, reason: AdmissionReason):
        self.reason = reason
        self.status_code = 413 if reason == AdmissionReason.SIZE_EXCEEDED else 422
        super().__init__(reason.value)


@dataclass(frozen=True)
class MusicXmlAdmissionLimits:
    max_bytes: int = 5 * 1024 * 1024
    max_elements: int = 250_000
    max_depth: int = 32
    max_attributes_per_element: int = 32
    max_attribute_value_chars: int = 4096
    max_text_chars_per_node: int = 65_536
    max_total_text_chars: int = 5 * 1024 * 1024

    def __post_init__(self) -> None:
        if any(getattr(self, field.name) <= 0 for field in fields(self)):
            raise ValueError("Document budgets must be positive")


MUSICXML_LIMITS = MusicXmlAdmissionLimits()
_READ_CHUNK = 64 * 1024


def read_bounded_bytes(
    chunks: Iterable[bytes], *, max_bytes: int = MUSICXML_LIMITS.max_bytes
) -> bytes:
    """Never retain a chunk that would cross the in-memory document ceiling."""
    data = bytearray()
    iterator = iter(chunks)
    try:
        for chunk in iterator:
            if len(chunk) > max_bytes - len(data):
                raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
            data.extend(chunk)
    finally:
        close = getattr(iterator, "close", None)
        if close is not None:
            close()
    return bytes(data)


def _file_chunks(stream: BinaryIO) -> Iterator[bytes]:
    while chunk := stream.read(_READ_CHUNK):
        yield chunk


def _content_chunks(content: bytes | str) -> Iterator[bytes]:
    for offset in range(0, len(content), _READ_CHUNK):
        chunk = content[offset : offset + _READ_CHUNK]
        yield chunk.encode("utf-8") if isinstance(chunk, str) else chunk


def _validated_bytes(chunks: Iterable[bytes], limits: MusicXmlAdmissionLimits) -> bytes:
    parser = expat.ParserCreate(encoding="UTF-8", namespace_separator="}")
    decoder = codecs.getincrementaldecoder("utf-8")("strict")
    elements = total_text = 0
    text_stack: list[int] = []
    namespace_count = 0
    declared_root: str | None = None

    def forbidden(*args: object) -> NoReturn:
        raise DocumentAdmissionError(AdmissionReason.DTD_OR_ENTITY_FORBIDDEN)

    def instruction(*args: object) -> NoReturn:
        raise DocumentAdmissionError(AdmissionReason.PROCESSING_INSTRUCTION_FORBIDDEN)

    def declaration(version: str, encoding: str | None, standalone: int) -> None:
        if encoding is not None and encoding.lower() not in {"utf-8", "utf8"}:
            raise DocumentAdmissionError(AdmissionReason.MALFORMED_XML)

    def doctype(name: str, system_id: str | None, public_id: str | None, internal: int) -> None:
        nonlocal declared_root
        if (
            internal
            or name not in {"score-partwise", "score-timewise"}
            or public_id
            != f"-//Recordare//DTD MusicXML 3.1 {name.removeprefix('score-').title()}//EN"
            or system_id != f"http://www.musicxml.org/dtds/{name.removeprefix('score-')}.dtd"
        ):
            forbidden()
        declared_root = name

    def start(name: str, attributes: dict[str, str]) -> None:
        nonlocal elements, namespace_count
        if elements == 0 and declared_root is not None and name != declared_root:
            forbidden()
        elements += 1
        if elements > limits.max_elements:
            raise DocumentAdmissionError(AdmissionReason.ELEMENT_COUNT_EXCEEDED)
        if len(text_stack) >= limits.max_depth:
            raise DocumentAdmissionError(AdmissionReason.DEPTH_EXCEEDED)
        if len(attributes) + namespace_count > limits.max_attributes_per_element:
            raise DocumentAdmissionError(AdmissionReason.ATTRIBUTES_EXCEEDED)
        if any(len(value) > limits.max_attribute_value_chars for value in attributes.values()):
            raise DocumentAdmissionError(AdmissionReason.ATTRIBUTE_VALUE_EXCEEDED)
        namespace_count = 0
        text_stack.append(0)

    def end(name: str) -> None:
        text_stack.pop()

    def text(value: str) -> None:
        nonlocal total_text
        total_text += len(value)
        if total_text > limits.max_total_text_chars:
            raise DocumentAdmissionError(AdmissionReason.TEXT_EXCEEDED)
        if text_stack:
            text_stack[-1] += len(value)
            if text_stack[-1] > limits.max_text_chars_per_node:
                raise DocumentAdmissionError(AdmissionReason.TEXT_EXCEEDED)

    def namespace(prefix: str | None, uri: str | None) -> None:
        nonlocal namespace_count
        namespace_count += 1
        if namespace_count > limits.max_attributes_per_element:
            raise DocumentAdmissionError(AdmissionReason.ATTRIBUTES_EXCEEDED)
        if uri is not None and len(uri) > limits.max_attribute_value_chars:
            raise DocumentAdmissionError(AdmissionReason.ATTRIBUTE_VALUE_EXCEEDED)

    parser.StartNamespaceDeclHandler = namespace
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.CharacterDataHandler = text
    parser.XmlDeclHandler = declaration
    parser.StartDoctypeDeclHandler = doctype
    parser.EntityDeclHandler = forbidden
    parser.UnparsedEntityDeclHandler = forbidden
    parser.NotationDeclHandler = forbidden
    parser.ExternalEntityRefHandler = forbidden
    parser.ProcessingInstructionHandler = instruction
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    data = bytearray()
    iterator = iter(chunks)
    try:
        for chunk in iterator:
            if len(chunk) > limits.max_bytes - len(data):
                raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
            if b"\x00" in chunk:
                raise DocumentAdmissionError(AdmissionReason.MALFORMED_XML)
            decoder.decode(chunk)
            parser.Parse(chunk, False)
            data.extend(chunk)
        decoder.decode(b"", final=True)
        parser.Parse(b"", True)
    except (expat.ExpatError, UnicodeError) as error:
        raise DocumentAdmissionError(AdmissionReason.MALFORMED_XML) from error
    finally:
        close = getattr(iterator, "close", None)
        if close is not None:
            close()
    return bytes(data)


def _parse(chunks: Iterable[bytes], limits: MusicXmlAdmissionLimits) -> ET.Element:
    admitted = _validated_bytes(chunks, limits)
    # Element allocation starts only after the complete streaming guard succeeds.
    try:
        return ET.fromstring(admitted)
    except (ET.ParseError, UnicodeError, LookupError) as error:
        raise DocumentAdmissionError(AdmissionReason.MALFORMED_XML) from error


def parse_musicxml(
    content: bytes | str, *, limits: MusicXmlAdmissionLimits = MUSICXML_LIMITS
) -> ET.Element:
    try:
        if len(content) > limits.max_bytes:
            raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
        size = 0
        for chunk in _content_chunks(content):
            size += len(chunk)
            if size > limits.max_bytes:
                raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
    except UnicodeError as error:
        raise DocumentAdmissionError(AdmissionReason.MALFORMED_XML) from error
    return _parse(_content_chunks(content), limits)


def parse_musicxml_file(path: str | Path) -> ET.ElementTree[ET.Element]:
    if Path(path).stat().st_size > MUSICXML_LIMITS.max_bytes:
        raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
    with Path(path).open("rb") as stream:
        return ET.ElementTree(_parse(_file_chunks(stream), MUSICXML_LIMITS))


def read_musicxml_file(path: str | Path) -> bytes:
    if Path(path).stat().st_size > MUSICXML_LIMITS.max_bytes:
        raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
    with Path(path).open("rb") as stream:
        return _validated_bytes(_file_chunks(stream), MUSICXML_LIMITS)


def parse_svg(content: str) -> ET.Element:
    """Bound renderer-generated vector pages with the same DTD/entity policy."""
    root = _parse(_content_chunks(content), MusicXmlAdmissionLimits(max_bytes=16 * 1024 * 1024))
    if root.tag.rsplit("}", 1)[-1] != "svg":
        raise DocumentAdmissionError(AdmissionReason.UNSUPPORTED_ROOT)
    return root
