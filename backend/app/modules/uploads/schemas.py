from app.modules.media_storage.upload_sessions.schemas import UploadSessionRead
from app.shared.api_model import ApiModel


class UploadRead(ApiModel):
    upload_id: str
    original_filename: str
    byte_size: int


__all__ = [
    "UploadRead",
]


class UploadAdmissionRead(ApiModel):
    client_request_id: str
    upload_session: UploadSessionRead
    upload: UploadRead | None = None
