"""Document notation title from canonical MusicXML work metadata."""

from app.platform.document_admission.musicxml import parse_musicxml


def extract_notation_title(content: bytes | str) -> str | None:
    root = parse_musicxml(content)
    work = next((child for child in root if child.tag.rsplit("}", 1)[-1] == "work"), None)
    if work is None:
        return None
    title = next((child for child in work if child.tag.rsplit("}", 1)[-1] == "work-title"), None)
    if title is None:
        return None
    return "".join(title.itertext()).strip() or None
