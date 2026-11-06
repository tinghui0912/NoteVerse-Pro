"""Storage adapters for uploaded and generated files."""

from .base import DirectUploadTarget, ObjectStorage, StoredFile, StoredObjectMetadata
from .factory import object_storage, get_object_storage

__all__ = [
    "ObjectStorage",
    "DirectUploadTarget",
    "StoredFile",
    "StoredObjectMetadata",
    "object_storage",
    "get_object_storage",
]
