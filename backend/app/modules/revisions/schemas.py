from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field
from typing import Literal

from app.db.models.score import RevisionOrigin
from app.shared.pagination import CursorPage


class RevisionCreateRequest(BaseModel):
    content: str = Field(min_length=1)
    base_revision_id: str
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)
    origin: RevisionOrigin = RevisionOrigin.EDIT


class RevisionActorRead(BaseModel):
    display_name: str | None
    email: str
    avatar_url: str | None


class RevisionRestoreRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class RevisionRestoreRead(BaseModel):
    restored_from_revision_id: str | None
    restored_from_revision_number: int | None
    note: str | None
    actor: RevisionActorRead | None
    created_at: datetime


class RevisionNoteUpdateRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class RevisionNoteRead(BaseModel):
    note: str
    author: RevisionActorRead | None
    updated_at: datetime


class RevisionRead(BaseModel):
    revision_id: str
    revision_number: int
    origin: RevisionOrigin
    created_at: datetime
    created_by: RevisionActorRead | None
    restore: RevisionRestoreRead | None
    note: RevisionNoteRead | None


class RevisionListRead(CursorPage[RevisionRead]):
    pass


class RevisionContentRead(RevisionRead):
    content: str
    mime_type: str


class FingeringRequest(BaseModel):
    content: str = Field(min_length=1)
    hand_size: Literal["XXS", "XS", "S", "M", "L", "XL", "XXL"] = "M"


class FingeringResultRead(BaseModel):
    content: str
