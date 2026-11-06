"""Admit the saved Take aggregate across Capture and durable server bytes."""

from dataclasses import dataclass
from app.core.exceptions import ValidationException
from app.shared.constants import ErrorCode
from app.db.models.performance_take import PerformanceTake
from app.modules.media.blob import MediaBlobFacts
from app.modules.media.persistence import blob_from_row
from .manifest import TakeManifest
from .manifest_persistence import manifest_from_row


@dataclass(frozen=True)
class SavedTakeFacts:
    manifest: TakeManifest
    blob: MediaBlobFacts

    def __post_init__(self) -> None:
        capture = self.manifest.snapshot.capture
        if capture.byte_size != self.blob.byte_size or capture.mime_type != self.blob.content_type:
            raise ValueError("Archived bytes must preserve the admitted Capture")


def take_from_row(row: PerformanceTake) -> SavedTakeFacts:
    try:
        return SavedTakeFacts(manifest_from_row(row.manifest), blob_from_row(row.media_blob))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValidationException(
            ErrorCode.VALIDATION_ERROR, field="media_blob", details={"reason": "invalid_archive"}
        ) from error
