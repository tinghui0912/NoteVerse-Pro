import hashlib

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    ConflictException,
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import StoredObject, StorageUsageCategory, User
from app.modules.files.repository import FilesRepository
from app.modules.storage_objects.retirement import retire_after_release
from app.modules.storage_objects.writes import write_object_async, adopt_written_object
from app.modules.files.schemas import DeleteUploadedFileRead, UploadFileRead
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage, object_storage


def blob_object_key(sha256: str, extension: str) -> str:
    return f"blobs/{sha256[:2]}/{sha256}{extension}"


class FilesService:
    """Own uploaded processing inputs; score source and derived delivery live elsewhere."""

    def __init__(
        self, repository: FilesRepository | None = None, storage: ObjectStorage | None = None
    ) -> None:
        self.repository = repository or FilesRepository()
        self.storage = storage or object_storage

    @staticmethod
    def allowed_file(filename: str) -> bool:
        return "." in filename and filename.rsplit(".", 1)[1].lower() in settings.ALLOWED_EXTENSIONS

    async def upload_file(
        self, db: AsyncSession, current_user: User, file: UploadFile
    ) -> UploadFileRead:
        if not file.filename:
            raise ValidationException(code=ErrorCode.NO_FILE_SELECTED, field="file")
        if not self.allowed_file(file.filename):
            raise ValidationException(
                code=ErrorCode.FILE_TYPE_NOT_ALLOWED,
                field="file",
                details={"allowed": list(settings.ALLOWED_EXTENSIONS)},
            )
        content = await file.read()
        file_hash = hashlib.sha256(content).hexdigest()
        extension = f".{file.filename.rsplit('.', 1)[1].lower()}"
        content_type = (
            (file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
        )
        user_id = require_persisted_id(current_user.id, entity="user")
        reservation = await storage_usage_service.reserve(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=len(content),
            reason="upload_file",
            object_type="upload",
            object_id=file_hash,
        )
        blob = await self.repository.get_upload_object_by_sha256(db, file_hash)
        key = blob.object_key if blob is not None else blob_object_key(file_hash, extension)
        if blob is not None:
            content_type = blob.content_type
        try:
            written = await write_object_async(
                db, self.storage, key=key, content=content, content_type=content_type
            )
            persisted_blob = await db.run_sync(lambda sync: adopt_written_object(sync, written))
            upload = await self.repository.create_upload(
                db,
                stored_object_id=require_persisted_id(persisted_blob.id, entity="stored object"),
                original_filename=file.filename,
                uploader_user_id=user_id,
            )
            await storage_usage_service.commit_reservation(
                db,
                reservation.reservation_id,
                object_type="upload",
                object_id=upload.upload_uuid,
                storage_key=persisted_blob.object_key,
            )
        except Exception as exc:
            await db.rollback()
            await storage_usage_service.release_reservation(db, reservation.reservation_id)
            if isinstance(exc, FileException):
                raise
            raise FileException(
                code=ErrorCode.FILE_SAVE_FAILED,
                filename=file.filename,
            ) from exc
        return UploadFileRead(
            file_id=upload.upload_uuid,
            filename=file.filename,
            size=persisted_blob.byte_size,
        )

    async def delete_uploaded_file(
        self, db: AsyncSession, current_user: User, filename: str
    ) -> DeleteUploadedFileRead:
        upload = await self.repository.get_upload_by_uuid(db, filename)
        if not upload:
            raise ResourceNotFoundException("file", filename, ErrorCode.FILE_NOT_FOUND)
        if upload.uploader_user_id != current_user.id:
            raise UnauthorizedException(ErrorCode.NO_DELETE_ACCESS, {"filename": filename})
        upload_id = require_persisted_id(upload.id, entity="upload")
        if await self.repository.upload_reference_count(db, upload_id) > 0:
            raise ConflictException(ErrorCode.VALIDATION_ERROR, {"upload_id": upload.upload_uuid})
        blob = await db.get(StoredObject, upload.stored_object_id)
        if blob is None:
            raise ResourceNotFoundException(
                "stored_object", str(upload.stored_object_id), ErrorCode.FILE_NOT_FOUND
            )
        size_bytes = blob.byte_size
        storage_key = blob.object_key
        upload_uuid = upload.upload_uuid
        await self.repository.delete_upload_by_id(
            db, require_persisted_id(upload.id, entity="upload")
        )
        await retire_after_release(db, blob.id)
        await storage_usage_service.record_release(
            db,
            user_id=require_persisted_id(current_user.id, entity="user"),
            category=StorageUsageCategory.UPLOAD,
            bytes_count=size_bytes,
            reason="delete_upload",
            object_type="upload",
            object_id=upload_uuid,
            storage_key=storage_key,
            auto_commit=False,
        )
        await db.commit()
        return DeleteUploadedFileRead(filename=filename)


files_service = FilesService()
