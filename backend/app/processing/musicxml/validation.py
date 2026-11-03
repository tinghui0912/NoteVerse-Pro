"""Validation helpers for canonical MusicXML documents."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from app.core.exceptions import ValidationException
from app.shared.constants import ErrorCode
from app.score_semantics.musicxml_tempo import MusicXMLTempoError, materialize_tempo_playback


def prepare_musicxml_document(content: bytes) -> bytes:
    """Admit a score document with explicit canonical tempo playback facts."""

    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID) from exc
    if root.tag.rsplit("}", 1)[-1] not in {"score-partwise", "score-timewise"}:
        raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID)
    try:
        changed = materialize_tempo_playback(root)
    except MusicXMLTempoError as exc:
        raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID) from exc
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) if changed else content
