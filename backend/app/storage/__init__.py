"""Storage adapters for uploaded and generated files."""

from .base import DirectUploadTarget, ObjectStorage, StoredObject, StoredObjectMetadata
from .factory import object_storage, get_object_storage

__all__ = [
    "ObjectStorage",
    "DirectUploadTarget",
    "StoredObject",
    "StoredObjectMetadata",
    "object_storage",
    "get_object_storage",
]
