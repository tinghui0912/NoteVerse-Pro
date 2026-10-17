"""Pydantic schemas for model asset delivery access."""

from typing import Literal
from pydantic import BaseModel


class ModelAssetAccessRead(BaseModel):
    """Access descriptor for client direct download of model assets."""

    schemaVersion: Literal[1] = 1
    assetId: str = "bytedance-piano-transcription-note-model"
    assetVersion: str = "CRNN_note_F1_0.9677_pedal_F1_0.9186"
    expectedByteSize: int = 98_691_493
    sha256: str = "6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5"
    mediaType: Literal["application/octet-stream"] = "application/octet-stream"
    downloadUrl: str
    downloadUrlExpiresAt: str


class ContinuousRobustAccessRead(BaseModel):
    """Immutable, separately qualified browser Continuous deployment; not the legacy export."""

    schemaVersion: Literal[1] = 1
    assetId: Literal["continuous-robust-browser"] = "continuous-robust-browser"
    assetVersion: Literal["v1"] = "v1"
    expectedByteSize: Literal[98_689_283] = 98_689_283
    sha256: Literal["4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3"] = "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3"
    mediaType: Literal["application/octet-stream"] = "application/octet-stream"
    downloadUrl: str
    downloadUrlExpiresAt: str
