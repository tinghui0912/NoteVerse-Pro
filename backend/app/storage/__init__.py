"""Storage adapters for uploaded and generated files."""

from .base import DirectUploadTarget, ObjectStorage, ObjectWriteResult, ObjectMetadata
from .factory import object_storage, get_object_storage
from .async_adapter import AsyncObjectStorage

async_object_storage = AsyncObjectStorage(object_storage)

__all__ = [
    "ObjectStorage",
    "AsyncObjectStorage",
    "async_object_storage",
    "DirectUploadTarget",
    "ObjectWriteResult",
    "ObjectMetadata",
    "object_storage",
    "get_object_storage",
]
