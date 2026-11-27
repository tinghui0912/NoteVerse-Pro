"""Storage adapters for uploaded and generated files."""

from .base import (
    DirectUploadTarget,
    ObjectStorage,
    ObjectWriteResult,
    ObjectMetadata,
    UploadedPart,
    MultipartUploadResult,
    ObjectNotFoundError,
    ObjectStorageUnavailableError,
    ObjectStorageOperationFailedError,
)
from .factory import object_storage, get_object_storage
from .async_reader import AsyncObjectReader

__all__ = [
    "ObjectStorage",
    "AsyncObjectReader",
    "DirectUploadTarget",
    "ObjectWriteResult",
    "ObjectMetadata",
    "UploadedPart",
    "MultipartUploadResult",
    "ObjectNotFoundError",
    "ObjectStorageUnavailableError",
    "ObjectStorageOperationFailedError",
    "object_storage",
    "get_object_storage",
]
