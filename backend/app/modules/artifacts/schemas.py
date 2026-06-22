from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.db.models.score import ArtifactKind


class ArtifactRead(BaseModel):
    artifact_id: str
    revision_id: str
    kind: ArtifactKind
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


class ArtifactAccessRead(BaseModel):
    artifact_id: str
    url: str
    filename: str
    mime_type: str
    expires_in: int | None


class ArtifactDiagnosticsRead(BaseModel):
    revision_id: str
    artifact_count: int
    missing_artifact_ids: list[str]
