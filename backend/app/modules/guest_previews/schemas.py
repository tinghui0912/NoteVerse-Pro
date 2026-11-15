from pydantic import BaseModel, ConfigDict
from app.shared.api_model import ApiModel


class GuestPreviewUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class GuestPreviewSettingsRead(ApiModel):
    enabled: bool
    token: str


class GuestPreviewPageRead(BaseModel):
    asset_id: str
    page_number: int


class GuestPreviewRead(ApiModel):
    display_title: str
    shared_by: str
    render_assets: list[GuestPreviewPageRead]
    audio_available: bool
