"""Admission of exact canonical MusicXML bytes, not full schema validation."""

from __future__ import annotations

from app.platform.document_admission.musicxml import parse_musicxml, DocumentAdmissionError
import xml.etree.ElementTree as ET

from app.core.exceptions import ValidationException
from app.shared.error_codes import CustomerErrorCode
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.score_semantics.musicxml_tempo import MusicXMLTempoError, materialize_tempo_playback


def admit_musicxml_document(content: bytes | str) -> bytes:
    """Require partwise, materialize explicit tempo, then validate the returned bytes."""
    try:
        root = parse_musicxml(content)
        if root.tag.rsplit("}", 1)[-1] != "score-partwise":
            raise ValidationException(CustomerErrorCode.REVISION_CONTENT_INVALID)
        changed = materialize_tempo_playback(root)
        admitted = (
            ET.tostring(root, encoding="utf-8", xml_declaration=True)
            if changed
            else (content.encode("utf-8") if isinstance(content, str) else content)
        )
        parse_score_semantics(admitted)
    except DocumentAdmissionError as exc:
        if exc.status_code == 413:
            raise
        raise ValidationException(
            CustomerErrorCode.REVISION_CONTENT_INVALID, details={"reason": exc.reason.value}
        ) from exc
    except (UnicodeError, MusicXMLTempoError, MusicXMLSemanticError) as exc:
        raise ValidationException(CustomerErrorCode.REVISION_CONTENT_INVALID) from exc
    return admitted
