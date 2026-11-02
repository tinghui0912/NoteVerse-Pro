from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GuestPreviewCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expires_at: datetime | None = None


class GuestPreviewListItem(BaseModel):
    preview_id: str
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime


class GuestPreviewCreatedRead(GuestPreviewListItem):
    token: str


class GuestPreviewPageRead(BaseModel):
    asset_id: str
    page_number: int


class GuestPreviewRead(BaseModel):
    title: str
    shared_by: str
    created_at: datetime
    expires_at: datetime
    render_assets: list[GuestPreviewPageRead]
    audio_available: bool
