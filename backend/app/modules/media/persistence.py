"""Single hydration boundary for immutable durable byte observations."""

from app.db.models.media_blob import MediaBlob
from .blob import MediaBlobFacts


def blob_from_row(row: MediaBlob) -> MediaBlobFacts:
    return MediaBlobFacts(
        row.storage_backend, row.object_key, row.byte_size, row.sha256, row.content_type
    )


def blob_to_row(value: MediaBlobFacts) -> MediaBlob:
    return MediaBlob(
        storage_backend=value.storage_backend,
        object_key=value.object_key,
        byte_size=value.byte_size,
        sha256=value.sha256,
        content_type=value.content_type,
    )
