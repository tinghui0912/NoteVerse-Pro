from app.shared.api_model import ApiModel


class UploadFileRead(ApiModel):
    file_id: str
    filename: str
    size: int


__all__ = [
    "UploadFileRead",
]
