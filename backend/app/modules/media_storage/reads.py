"""Admitted object facts authorize reads; provider failures never redefine existence."""

from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from hashlib import sha256

from app.platform.document_admission.musicxml import (
    MUSICXML_LIMITS,
    AdmissionReason,
    DocumentAdmissionError,
    read_bounded_bytes,
)
from app.core.exceptions import ExternalServiceException
from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.db.models import StoredObject
from app.shared.error_codes import CustomerErrorCode
from app.storage import AsyncObjectReader, ObjectStorage
from app.storage.base import (
    ObjectStorageUnavailableError,
    ObjectStorageOperationFailedError,
    ObjectNotFoundError,
)


class StoredObjectIntegrityError(RuntimeError):
    """An admitted durable object cannot supply its physical bytes."""


@dataclass(frozen=True)
class StoredObjectReadTarget:
    stored_object_id: int
    storage_key: str
    byte_size: int
    media_type: str

    @staticmethod
    def from_object(row: StoredObject) -> "StoredObjectReadTarget":
        return StoredObjectReadTarget(
            require_persisted_id(row.id, entity="stored object"),
            row.object_key,
            row.byte_size,
            row.content_type,
        )


@dataclass(frozen=True)
class StoredObjectDelivery(StoredObjectReadTarget):
    filename: str

    @classmethod
    def for_object(cls, row: StoredObject, filename: str) -> "StoredObjectDelivery":
        return cls(
            require_persisted_id(row.id, entity="stored object"),
            row.object_key,
            row.byte_size,
            row.content_type,
            filename,
        )


@contextmanager
def _physical_read(target: StoredObjectReadTarget, operation: str) -> Iterator[None]:
    try:
        yield
    except (
        OSError,
        ObjectNotFoundError,
        ObjectStorageUnavailableError,
        ObjectStorageOperationFailedError,
    ) as error:
        missing = isinstance(error, ObjectNotFoundError)
        logger.bind(
            event="stored_object.read_failed",
            stored_object_id=target.stored_object_id,
            object_locator_hash=sha256(target.storage_key.encode()).hexdigest(),
            read_operation=operation,
            read_failure_classification="integrity" if missing else "availability",
            exception_type=type(error).__name__,
        ).opt(exception=error).error("Admitted object read failed")
        if missing:
            raise StoredObjectIntegrityError("Admitted object bytes are missing") from error
        raise ExternalServiceException(
            "object_storage", code=CustomerErrorCode.STORAGE_BACKEND_UNAVAILABLE
        ) from error


def read_admitted_bytes(
    storage: ObjectStorage,
    target: StoredObjectReadTarget,
    *,
    max_bytes: int = MUSICXML_LIMITS.max_bytes,
) -> bytes:
    with _physical_read(target, "read_bytes"):
        if target.byte_size > max_bytes:
            raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
        chunks = storage.iter_bytes(target.storage_key, chunk_size=64 * 1024)
        return read_bounded_bytes(chunks, max_bytes=max_bytes)


async def iterate_admitted_bytes(
    storage: ObjectStorage,
    target: StoredObjectReadTarget,
    *,
    chunk_size: int,
    start: int | None = None,
    end: int | None = None,
) -> AsyncIterator[bytes]:
    xml_document = target.media_type in {
        "application/xml",
        "text/xml",
        "application/vnd.recordare.musicxml+xml",
    }
    if xml_document and target.byte_size > MUSICXML_LIMITS.max_bytes:
        raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
    total = 0
    with _physical_read(target, "iter_bytes"):
        async for chunk in AsyncObjectReader(storage).iter_bytes(
            target.storage_key, chunk_size=chunk_size, start=start, end=end
        ):
            total += len(chunk)
            if xml_document and total > MUSICXML_LIMITS.max_bytes:
                raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
            yield chunk


def materialize_admitted_object(
    storage: ObjectStorage, target: StoredObjectReadTarget, path: str
) -> str:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    xml_document = target.media_type in {
        "application/xml",
        "text/xml",
        "application/vnd.recordare.musicxml+xml",
    }
    if xml_document and target.byte_size > MUSICXML_LIMITS.max_bytes:
        raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
    with _physical_read(target, "materialize"):
        with destination.open("wb") as output:
            total = 0
            for chunk in storage.iter_bytes(target.storage_key, chunk_size=64 * 1024):
                total += len(chunk)
                if xml_document and total > MUSICXML_LIMITS.max_bytes:
                    raise DocumentAdmissionError(AdmissionReason.SIZE_EXCEEDED)
                output.write(chunk)
    return str(destination)
