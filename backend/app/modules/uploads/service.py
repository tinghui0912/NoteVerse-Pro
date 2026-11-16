import hashlib

from fastapi import UploadFile
from sqlalchemy.orm import Session

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
    return f"blobs/{sha256[:2]}/{sha256}{extension}"


class UploadService:
    """Own uploaded processing inputs; score source and derived delivery live elsewhere."""

    def __init__(
        self, repository: UploadRepository | None = None, storage: ObjectStorage | None = None
    ) -> None:
        self.repository = repository or UploadRepository()
        self.storage = storage or object_storage

    def create_upload(self, db: Session, current_user: User, file: UploadFile) -> UploadRead:
        if not file.filename:
            raise ValidationException(code=CustomerErrorCode.NO_FILE_SELECTED, field="file")
        content = read_score_import_upload(file)
        media = admit_score_import_image(content, file.filename)
        file_hash = hashlib.sha256(content).hexdigest()
        extension = media.extension
        content_type = media.mime_type
        user_id = require_persisted_id(current_user.id, entity="user")
        reservation = storage_usage_service.reserve(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=len(content),
            reason="upload_created",
            object_type="upload",
            object_id=file_hash,
        )
        try:
            db.commit()
            blob = self.repository.get_upload_object_by_sha256(db, file_hash)
            key = blob.object_key if blob is not None else blob_object_key(file_hash, extension)
            written = write_object(
                db, self.storage, key=key, content=content, content_type=content_type
            )
            persisted_blob = adopt_written_object(db, written)
            upload = self.repository.create_upload(
                db,
                stored_object_id=require_persisted_id(persisted_blob.id, entity="stored object"),
                original_filename=file.filename,
                uploader_user_id=user_id,
            )
            storage_usage_service.commit_reservation(
                db,
                reservation.reservation_id,
                object_type="upload",
                object_id=upload.upload_uuid,
                storage_key=persisted_blob.object_key,
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            storage_usage_service.release_reservation(db, reservation.reservation_id)
            db.commit()
            if isinstance(exc, FileException):
                raise
            raise FileException(
                code=CustomerErrorCode.FILE_SAVE_FAILED,
                filename=file.filename,
            ) from exc
        return UploadRead(
            upload_id=upload.upload_uuid,
            original_filename=upload.original_filename,
            byte_size=persisted_blob.byte_size,
        )

    def delete_upload(self, db: Session, current_user: User, upload_id: str) -> None:
        upload = self.repository.get_upload_by_uuid(db, upload_id)
        if not upload:
            raise ResourceNotFoundException("upload", upload_id)
        if upload.uploader_user_id != current_user.id:
            raise UnauthorizedException(
                CustomerErrorCode.NO_DELETE_ACCESS, {"upload_id": upload_id}
            )
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
        retire_after_release(db, blob.id)
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
        db.commit()
        return None


upload_service = UploadService()
