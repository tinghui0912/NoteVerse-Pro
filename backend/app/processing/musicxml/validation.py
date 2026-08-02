"""Validation helpers for canonical MusicXML documents."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from app.core.exceptions import ValidationException
from app.shared.constants import ErrorCode


def validate_musicxml_document(content: bytes) -> None:
    """Require a parseable score-partwise or score-timewise document."""

    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID) from exc
    if root.tag.rsplit("}", 1)[-1] not in {"score-partwise", "score-timewise"}:
        raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID)
