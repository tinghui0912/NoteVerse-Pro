"""Storage adapters for uploaded and generated files."""

from .base import FileStorage, StoredFile
from .factory import file_storage, get_file_storage
from .local import (
    LocalFileStorage,
)

__all__ = [
    "FileStorage",
    "LocalFileStorage",
    "StoredFile",
    "file_storage",
    "get_file_storage",
]
