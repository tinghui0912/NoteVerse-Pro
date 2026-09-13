"""Storage adapters for uploaded and generated files."""

from .base import DirectUploadTarget, FileStorage, StoredFile, StoredObjectMetadata
from .factory import file_storage, get_file_storage
from .local import (
    LocalFileStorage,
)

__all__ = [
    "FileStorage",
    "DirectUploadTarget",
    "LocalFileStorage",
    "StoredFile",
    "StoredObjectMetadata",
    "file_storage",
    "get_file_storage",
]
