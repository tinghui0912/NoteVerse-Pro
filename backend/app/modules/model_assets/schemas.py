"""Strict transport shape bound to the generated acoustic deployment descriptor."""

from typing import Self
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.modules.model_assets.generated.practice_acoustic_model_asset import MODEL_ASSET_DESCRIPTOR


class PracticeAcousticAccessRead(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    schemaVersion: int = Field(gt=0)
    assetId: str
    assetVersion: str
    expectedByteSize: int = Field(gt=0)
    sha256: str
    mediaType: str
    downloadUrl: str
    downloadUrlExpiresAt: str

    @model_validator(mode="after")
    def validate_deployment(self) -> Self:
        if self.model_dump(include=set(MODEL_ASSET_DESCRIPTOR)) != dict(MODEL_ASSET_DESCRIPTOR):
            raise ValueError("Acoustic access identity does not match the configured deployment")
        return self
