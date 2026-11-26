"""Database-free verification of one reservation-owned physical candidate."""

from dataclasses import dataclass
import hashlib
import hmac
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.shared.error_codes import CustomerErrorCode
from app.storage import ObjectStorage
from app.modules.media_storage.facts import StoredObjectFacts
from .manifest import TakeManifest
from .recording_media_admission import (
    normalize_recording_mime,
    verify_recording_container_signature,
)
from .upload_reservation.domain import FinalizeLease


@dataclass(frozen=True)
class VerifiedPerformanceTakeCandidate:
    lease: FinalizeLease
    object_facts: StoredObjectFacts
    take_uuid: str
    user_id: int
    manifest_document: str
    manifest_sha256: str

    def validate(self, manifest: TakeManifest) -> None:
        capture = manifest.snapshot.capture
        if (
            self.object_facts.object_key != self.lease.object_key
            or self.take_uuid != manifest.take_uuid
            or self.user_id != manifest.user_id
            or self.manifest_document != manifest.canonical_document_json
            or self.manifest_sha256 != manifest.document_sha256
            or self.object_facts.content_type != capture.mime_type
            or self.object_facts.byte_size != capture.byte_size
        ):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="candidate")


def _sha256_storage_object(storage: ObjectStorage, key: str) -> str:
    digest = hashlib.sha256()
    for chunk in storage.iter_bytes(key, chunk_size=1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


class PerformanceTakeFinalMedia:
    def __init__(self, storage: ObjectStorage) -> None:
        self.storage = storage

    def verify(
        self, manifest: TakeManifest, lease: FinalizeLease, staging_key: str
    ) -> VerifiedPerformanceTakeCandidate:
        capture = manifest.snapshot.capture
        if not self.storage.exists(staging_key):
            raise ResourceNotFoundException(
                "performance_take_media_object",
                manifest.take_uuid,
                CustomerErrorCode.FILE_NOT_FOUND,
            )

        def validate_metadata(key: str) -> None:
            metadata = self.storage.object_metadata(key)
            if metadata.size_bytes != capture.byte_size:
                raise ValidationException(
                    CustomerErrorCode.VALIDATION_ERROR, field="media_byte_size"
                )
            if (
                metadata.content_type is not None
                and normalize_recording_mime(metadata.content_type) != capture.mime_type
            ):
                raise ValidationException(
                    CustomerErrorCode.VALIDATION_ERROR, field="media_mime_type"
                )

        validate_metadata(staging_key)
        header = b"".join(
            [
                chunk
                for chunk in self.storage.iter_bytes(staging_key, chunk_size=64, start=0, end=63)
            ]
        )
        if not verify_recording_container_signature(capture.kind, capture.mime_type, header):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="media_mime_type")
        staging_sha = _sha256_storage_object(self.storage, staging_key)
        self.storage.copy(staging_key, lease.object_key)
        validate_metadata(lease.object_key)
        candidate_sha = _sha256_storage_object(self.storage, lease.object_key)
        if not hmac.compare_digest(staging_sha, candidate_sha):
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="media_checksum",
                details={"reason": "candidate_content_mismatch"},
            )
        candidate = VerifiedPerformanceTakeCandidate(
            lease,
            StoredObjectFacts(
                lease.object_key, capture.byte_size, candidate_sha, capture.mime_type
            ),
            manifest.take_uuid,
            manifest.user_id,
            manifest.canonical_document_json,
            manifest.document_sha256,
        )
        candidate.validate(manifest)
        return candidate
