"""Document notation title from canonical MusicXML work metadata."""

import xml.etree.ElementTree as ET


def extract_notation_title(content: bytes | str) -> str | None:
    root = ET.fromstring(content)
    work = next((child for child in root if child.tag.rsplit("}", 1)[-1] == "work"), None)
    if work is None:
        return None
    title = next((child for child in work if child.tag.rsplit("}", 1)[-1] == "work-title"), None)
    if title is None:
        return None
    return "".join(title.itertext()).strip() or None
