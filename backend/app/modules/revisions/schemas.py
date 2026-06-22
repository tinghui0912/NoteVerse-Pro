from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field
from typing import Literal

from app.db.models.score import RevisionOrigin


class RevisionCreateRequest(BaseModel):
    content: str = Field(min_length=1)
    base_revision_id: str
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)
    origin: RevisionOrigin = RevisionOrigin.EDIT


class RevisionRead(BaseModel):
    revision_id: str
    revision_number: int
    parent_revision_id: str | None
    base_revision_id: str | None
    content_hash: str
    origin: RevisionOrigin
    created_at: datetime


class RevisionContentRead(RevisionRead):
    content: str
    mime_type: str


class FingeringRevisionRequest(BaseModel):
    base_revision_id: str
    hand: Literal["left", "right", "both"] = "both"
    depth: int = Field(default=6, ge=1, le=20)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)
