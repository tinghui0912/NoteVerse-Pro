from __future__ import annotations

from typing import Optional, TypedDict


class ImportJobStoredArtifactItem(TypedDict):
    write_intent_uuid: str
    write_token: str
    filename: str
    page_number: Optional[int]
