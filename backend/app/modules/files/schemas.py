from typing_extensions import TypedDict


class UploadFileResult(TypedDict):
    file_id: str
    filename: str
    storage_key: str
    size: int


class DeleteUploadedFileResult(TypedDict):
    filename: str


__all__ = ["UploadFileResult", "DeleteUploadedFileResult"]
