from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.db.models.score import RenderAssetKind, RevisionSourceFormat


class RevisionSourceRead(BaseModel):
    source_id: str
    revision_id: str
    format: RevisionSourceFormat
    filename: str
    mime_type: str
    size_bytes: int | None
    sha256: str
    generator: str
    generator_version: str
    created_at: datetime
    available: bool


class RenderAssetRead(BaseModel):
    render_asset_id: str
    revision_id: str
    kind: RenderAssetKind
    filename: str
    mime_type: str
    size_bytes: int | None
    sha256: str
    page_number: int | None
    render_profile: str | None
    generator: str
    generator_version: str
    created_at: datetime
    available: bool


class ScoreRevisionAssetsRead(BaseModel):
    revision_sources: list[RevisionSourceRead]
    render_assets: list[RenderAssetRead]


DerivedAssetStatus = Literal["pending", "processing", "ready", "failed"]


class ScoreDerivedAssetRead(BaseModel):
    status: DerivedAssetStatus = "pending"
    asset_id: str | None = None
    revision_id: str | None = None
    is_fallback: bool = False


class ScoreDerivedAssetsRead(BaseModel):
    preview: ScoreDerivedAssetRead
    audio: ScoreDerivedAssetRead


class AssetAccessRead(BaseModel):
    asset_id: str
    url: str
    filename: str
    mime_type: str
    expires_in: int | None


class RenderAssetDiagnosticsRead(BaseModel):
    revision_id: str
    render_asset_count: int
    missing_render_asset_ids: list[str]
