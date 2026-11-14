from app.shared.api_model import ApiModel


class UploadRead(ApiModel):
    upload_id: str
    original_filename: str
    byte_size: int


__all__ = [
    "UploadRead",
]
