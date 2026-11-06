from __future__ import annotations

from typing import Optional, TypedDict


class ImportJobStoredArtifactItem(TypedDict):
    storage_key: str
    filename: str
    page_number: Optional[int]
    size: int
    mime_type: str
    sha256: str
