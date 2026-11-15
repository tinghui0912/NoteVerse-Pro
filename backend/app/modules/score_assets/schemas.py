from __future__ import annotations


from app.shared.time import Instant
from typing import Literal

from pydantic import BaseModel

from app.db.models.score import RenderAssetKind, RevisionSourceFormat
from app.shared.api_model import ApiModel


class RevisionSourceRead(BaseModel):
    source_id: str
    revision_id: str
    format: RevisionSourceFormat
    filename: str
    mime_type: str
    size_bytes: int | None
    created_at: Instant
    available: bool


class RenderAssetRead(BaseModel):
    render_asset_id: str
    revision_id: str
    kind: RenderAssetKind
    filename: str
    mime_type: str
    size_bytes: int | None
    page_number: int | None
    created_at: Instant
    available: bool


class ScoreRevisionAssetsRead(ApiModel):
    revision_sources: list[RevisionSourceRead]
    render_assets: list[RenderAssetRead]


DerivedAssetStatus = Literal["pending", "processing", "ready", "unavailable"]


class ScoreDerivedAssetRead(BaseModel):
    status: DerivedAssetStatus
    asset_id: str | None


class ScoreDerivedAssetsRead(BaseModel):
    preview: ScoreDerivedAssetRead
    audio: ScoreDerivedAssetRead


class AssetAccessRead(ApiModel):
    asset_id: str
    url: str
    filename: str
    mime_type: str
    expires_in: int | None
