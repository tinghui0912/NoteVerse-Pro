"""Deployment composition for the authoritative durable object namespace."""

from functools import lru_cache
from app.storage.base import ObjectStorage
from app.storage.s3_compatible import S3CompatibleObjectStorage


@lru_cache(maxsize=1)
def get_object_storage() -> ObjectStorage:
    return S3CompatibleObjectStorage()


object_storage = get_object_storage()
