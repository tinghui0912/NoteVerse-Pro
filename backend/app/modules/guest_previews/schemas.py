from app.shared.time import Instant
from pydantic import BaseModel
from app.shared.api_model import ApiModel


class GuestPreviewSettingsRead(ApiModel):
    enabled: bool
    issued_at: Instant | None


class GuestPreviewCredentialIssuedRead(ApiModel):
    token: str
    issued_at: Instant


class GuestPreviewPageRead(BaseModel):
    asset_id: str
    page_number: int


class GuestPreviewRead(ApiModel):
    display_title: str
    shared_by: str
    render_assets: list[GuestPreviewPageRead]
    audio_available: bool
