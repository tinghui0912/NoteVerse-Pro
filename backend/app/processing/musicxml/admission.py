"""Admission of exact canonical MusicXML bytes, not full schema validation."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from app.core.exceptions import ValidationException
from app.shared.constants import ErrorCode
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.score_semantics.musicxml_tempo import MusicXMLTempoError, materialize_tempo_playback


def admit_musicxml_document(content: bytes) -> bytes:
    """Require partwise, materialize explicit tempo, then validate the returned bytes."""
    try:
        root = ET.fromstring(content)
        if root.tag.rsplit("}", 1)[-1] != "score-partwise":
            raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID)
        changed = materialize_tempo_playback(root)
        admitted = ET.tostring(root, encoding="utf-8", xml_declaration=True) if changed else content
        parse_score_semantics(admitted)
    except (ET.ParseError, UnicodeError, MusicXMLTempoError, MusicXMLSemanticError) as exc:
        raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID) from exc
    return admitted
