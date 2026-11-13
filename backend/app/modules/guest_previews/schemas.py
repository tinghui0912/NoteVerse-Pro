from pydantic import BaseModel, ConfigDict


class GuestPreviewUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class GuestPreviewSettingsRead(BaseModel):
    enabled: bool
    token: str


class GuestPreviewPageRead(BaseModel):
    asset_id: str
    page_number: int


class GuestPreviewRead(BaseModel):
    title: str
    shared_by: str
    render_assets: list[GuestPreviewPageRead]
    audio_available: bool
