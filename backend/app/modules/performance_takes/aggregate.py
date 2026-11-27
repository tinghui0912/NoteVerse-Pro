"""Admit the PerformanceTake aggregate across Capture and durable server bytes."""

from dataclasses import dataclass
from app.core.exceptions import ValidationException
from app.shared.error_codes import CustomerErrorCode
from app.db.models.performance_take import PerformanceTake
from app.modules.media_storage.facts import StoredObjectFacts
from app.modules.media_storage.persistence import object_from_row
from .manifest import TakeManifest
from .manifest_persistence import manifest_from_row


@dataclass(frozen=True)
class PerformanceTakeFacts:
    manifest: TakeManifest
    recording_object: StoredObjectFacts

    def __post_init__(self) -> None:
        capture = self.manifest.snapshot.capture
        if (
            capture.byte_size != self.recording_object.byte_size
            or capture.mime_type != self.recording_object.content_type
        ):
            raise ValueError("PerformanceTake recording bytes must preserve the admitted Capture")


def performance_take_facts_from_row(row: PerformanceTake) -> PerformanceTakeFacts:
    try:
        return PerformanceTakeFacts(
            manifest_from_row(row.manifest), object_from_row(row.recording_object)
        )
    except (ValueError, TypeError, AttributeError) as error:
        raise ValidationException(
            CustomerErrorCode.VALIDATION_ERROR,
            field="stored_object",
            details={"reason": "invalid_recording_object"},
        ) from error
