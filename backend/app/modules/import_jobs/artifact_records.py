from __future__ import annotations

from typing import Optional, TypedDict


class ImportJobStoredArtifactItem(TypedDict):
    storage_backend: str
    storage_key: str
    filename: str
    page_number: Optional[int]
    size: Optional[int]
    mime_type: Optional[str]
    sha256: Optional[str]
