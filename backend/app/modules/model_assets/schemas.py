"""Pydantic schemas for model asset delivery access."""

from typing import Literal
from pydantic import BaseModel


class PracticeAcousticAccessRead(BaseModel):
    """The sole immutable browser Practice acoustic deployment."""

    schemaVersion: Literal[1] = 1
    assetId: Literal["practice-acoustic-robust-browser"] = "practice-acoustic-robust-browser"
    assetVersion: Literal["v1"] = "v1"
    expectedByteSize: Literal[98_689_283] = 98_689_283
    sha256: Literal["4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3"] = "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3"
    mediaType: Literal["application/octet-stream"] = "application/octet-stream"
    downloadUrl: str
    downloadUrlExpiresAt: str
