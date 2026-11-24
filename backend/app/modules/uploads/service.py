from app.composition.storage_resources import storage_quota_service
from datetime import timedelta
from app.shared.time import utc_now
import json
import hashlib
import re

from fastapi import UploadFile
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.engine import Connection
from app.core.logger import logger
from app.modules.account.resource_admission import lock_active_resource_user
from app.db.models import UploadCreationRequest, StorageQuotaHoldStatus, Upload
from app.modules.storage_quota.contracts import StorageQuotaHoldReceipt

from app.core.exceptions import (
    ConflictException,
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import StoredObject, StorageUsageCategory, User
from app.modules.uploads.repository import UploadRepository
from app.modules.storage_objects.retirement import retire_after_release
from app.modules.storage_objects.writes import write_object, adopt_written_object
from app.modules.uploads.schemas import UploadRead
from app.modules.storage_usage.service import storage_usage_service
from app.shared.error_codes import CustomerErrorCode
from app.storage import object_storage, ObjectStorage
from app.modules.uploads.upload_admission import read_score_import_upload, admit_score_import_image


def blob_object_key(sha256: str, extension: str) -> str:
    if re.fullmatch(r"[0-9a-f]{64}", sha256) is None:
        raise ValueError("Upload identity requires a full lowercase SHA-256")
    if re.fullmatch(r"\.[a-z0-9]+", extension) is None:
        raise ValueError("Upload extension must be an admitted file extension")
    return f"blobs/{sha256[:2]}/{sha256}{extension}"


class UploadService:
    """Own uploaded processing inputs; score source and derived delivery live elsewhere."""

    def __init__(
        self, repository: UploadRepository | None = None, storage: ObjectStorage | None = None
    ) -> None:
        self.repository = repository or UploadRepository()
        self.storage = storage or object_storage

    def create_upload(
        self, db: Session, current_user: User, file: UploadFile, *, client_request_id: str
    ) -> UploadRead:
        if not file.filename:
            raise ValidationException(code=CustomerErrorCode.NO_FILE_SELECTED, field="file")
        if (
            not client_request_id
            or client_request_id != client_request_id.strip()
            or len(client_request_id) > 128
        ):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="client_request_id")
        content = read_score_import_upload(file)
        media = admit_score_import_image(content, file.filename)
        digest = hashlib.sha256(content).hexdigest()
        fingerprint = hashlib.sha256(
            json.dumps(
                [file.filename, digest, media.mime_type], ensure_ascii=False, separators=(",", ":")
            ).encode()
        ).hexdigest()
        user_id = require_persisted_id(current_user.id, entity="user")
        bind = db.get_bind()
        fresh_session = sessionmaker(
            bind=bind.engine if isinstance(bind, Connection) else bind, expire_on_commit=False
        )
        lock_active_resource_user(db, user_id)
        storage_quota_service.lock_user(db, user_id)
        request = self.repository.creation_request(db, user_id, client_request_id, lock=True)
        if request is not None and request.request_fingerprint != fingerprint:
            raise ConflictException(
                CustomerErrorCode.VALIDATION_ERROR, {"reason": "upload_request_conflict"}
            )
        existing_result = None
        reservation: StorageQuotaHoldReceipt | None = None
        if request is not None and request.completed_at is not None:
            existing_result = self._creation_result(db, request)
        else:
            if request is not None:
                reservation = storage_quota_service.lock_hold(db, request.quota_hold_id)
                if reservation.status == StorageQuotaHoldStatus.CONSUMED:
                    raise RuntimeError("Consumed Upload hold has no completed semantic owner")
                if (
                    reservation.status == StorageQuotaHoldStatus.HELD
                    and reservation.expires_at <= utc_now()
                ):
                    storage_quota_service.release_hold(db, reservation.hold_id)
                    reservation = None
                elif reservation.status != StorageQuotaHoldStatus.HELD:
                    reservation = None
            if reservation is None:
                generation = 1 if request is None else request.generation + 1
                reservation = storage_quota_service.create_hold(
                    db,
                    user_id=user_id,
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=len(content),
                    command_key=f"upload:{client_request_id}:{generation}",
                    expires_at=utc_now() + timedelta(minutes=15),
                )
                if request is None:
                    request = UploadCreationRequest(
                        user_id=user_id,
                        client_request_id=client_request_id,
                        request_fingerprint=fingerprint,
                        generation=generation,
                        quota_hold_id=reservation.hold_id,
                    )
                    db.add(request)
                else:
                    request.generation = generation
                    request.quota_hold_id = reservation.hold_id
                    request.updated_at = utc_now()
            db.flush()
        attempt_hold_id = reservation.hold_id if reservation else None
        try:
            db.commit()  # Upload intent + capacity generation are durable before physical IO.
            if existing_result is not None:
                return existing_result
            assert reservation is not None
            key = blob_object_key(digest, media.extension)
            written = write_object(
                db, self.storage, key=key, content=content, content_type=media.mime_type
            )
            lock_active_resource_user(db, user_id)
            storage_quota_service.lock_user(db, user_id)
            request = self.repository.creation_request(db, user_id, client_request_id, lock=True)
            if request is None:
                raise ResourceNotFoundException("upload_request", client_request_id)
            if request.completed_at is not None:
                result = self._creation_result(db, request)
                db.commit()
                return result
            if request.quota_hold_id != attempt_hold_id:
                raise ConflictException(
                    CustomerErrorCode.VALIDATION_ERROR, {"reason": "upload_generation_lost"}
                )
            held = storage_quota_service.lock_hold(db, request.quota_hold_id)
            if (held.user_id, held.category, held.bytes_held) != (
                user_id,
                StorageUsageCategory.UPLOAD,
                len(content),
            ):
                raise RuntimeError("Upload quota lineage disagrees with admitted content")
            if not storage_quota_service.consume_hold(db, held.hold_id):
                raise RuntimeError("New Upload requires unconsumed capacity")
            blob = adopt_written_object(db, written)
            upload = self.repository.create_upload(
                db,
                stored_object_id=require_persisted_id(blob.id, entity="stored object"),
                original_filename=file.filename,
                uploader_user_id=user_id,
            )
            request.upload_id = require_persisted_id(upload.id, entity="upload")
            request.completed_at = request.updated_at = utc_now()
            storage_usage_service.record_allocation(
                db,
                user_id=user_id,
                category=StorageUsageCategory.UPLOAD,
                bytes_count=len(content),
                reason="upload_created",
                object_type="upload",
                object_id=upload.upload_uuid,
                storage_key=blob.object_key,
            )
            result = self._creation_result(db, request)
            db.commit()
            return result
        except Exception as error:
            try:
                db.rollback()
            except Exception:
                logger.bind(resource_id=hashlib.sha256(client_request_id.encode()).hexdigest()).opt(
                    exception=True
                ).warning("upload.request_session_rollback_failed")
                db.invalidate()
            # A completion acknowledgement is not evidence that COMMIT failed. Read fresh lineage.
            with fresh_session() as recovery:
                current = self.repository.creation_request(recovery, user_id, client_request_id)
                if current is not None and current.completed_at is not None:
                    return self._creation_result(recovery, current)
                if current is not None and current.quota_hold_id == attempt_hold_id:
                    storage_quota_service.release_hold(recovery, current.quota_hold_id)
                    recovery.commit()
            if isinstance(
                error,
                (
                    FileException,
                    ConflictException,
                    ValidationException,
                    ResourceNotFoundException,
                    UnauthorizedException,
                ),
            ):
                raise
            raise FileException(
                code=CustomerErrorCode.FILE_SAVE_FAILED, filename=file.filename
            ) from error

    @staticmethod
    def _creation_result(db: Session, request: UploadCreationRequest) -> UploadRead:
        upload = db.get(Upload, request.upload_id) if request.upload_id is not None else None
        if upload is None:
            raise ResourceNotFoundException(
                "upload", request.client_request_id, CustomerErrorCode.FILE_NOT_FOUND
            )
        return UploadRead(
            upload_id=upload.upload_uuid,
            original_filename=upload.original_filename,
            byte_size=upload.stored_object.byte_size,
        )

    def delete_upload(self, db: Session, current_user: User, upload_id: str) -> None:
        upload = self.repository.get_upload_by_uuid(db, upload_id)
        if not upload:
            raise ResourceNotFoundException("upload", upload_id)
        if upload.uploader_user_id != current_user.id:
            raise UnauthorizedException(
                CustomerErrorCode.NO_DELETE_ACCESS, {"upload_id": upload_id}
            )
        storage_usage_service.committed_bytes(
            db, require_persisted_id(current_user.id, entity="user"), lock=True
        )
        upload = self.repository.get_upload_by_uuid(db, upload_id, lock=True)
        if upload is None:
            raise ResourceNotFoundException("upload", upload_id)
        upload_pk = require_persisted_id(upload.id, entity="upload")
        if self.repository.upload_reference_count(db, upload_pk) > 0:
            raise ConflictException(
                CustomerErrorCode.VALIDATION_ERROR, {"upload_id": upload.upload_uuid}
            )
        blob = db.get(StoredObject, upload.stored_object_id)
        if blob is None:
            raise RuntimeError("Upload is missing its required stored object")
        size_bytes = blob.byte_size
        storage_key = blob.object_key
        upload_uuid = upload.upload_uuid
        self.repository.delete_upload_by_id(db, require_persisted_id(upload.id, entity="upload"))
        storage_usage_service.record_release(
            db,
            user_id=require_persisted_id(current_user.id, entity="user"),
            category=StorageUsageCategory.UPLOAD,
            bytes_count=size_bytes,
            reason="delete_upload",
            object_type="upload",
            object_id=upload_uuid,
            storage_key=storage_key,
        )
        retire_after_release(db, blob.id)
        return None


upload_service = UploadService()
