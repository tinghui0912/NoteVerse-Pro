"""Storage adapters for uploaded and generated files."""

from .base import DirectUploadTarget, ObjectStorage, ObjectWriteResult, ObjectMetadata
from .factory import object_storage, get_object_storage

__all__ = [
    "ObjectStorage",
    "DirectUploadTarget",
    "ObjectWriteResult",
    "ObjectMetadata",
    "object_storage",
    "get_object_storage",
]
