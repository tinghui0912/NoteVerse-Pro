from pydantic import BaseModel


class UploadFileRead(BaseModel):
    file_id: str
    filename: str
    size: int


class DeleteUploadedFileRead(BaseModel):
    filename: str


__all__ = [
    "DeleteUploadedFileRead",
    "UploadFileRead",
]
