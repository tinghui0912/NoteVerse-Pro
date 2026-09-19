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
