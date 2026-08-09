import hashlib

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ConflictException, FileException, ResourceNotFoundException, UnauthorizedException, ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models import StorageBlob, StorageUsageCategory, User
from app.modules.files.repository import FilesRepository
from app.modules.files.schemas import DeleteUploadedFileRead, UploadFileRead
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


class FilesService:
    """Own uploaded processing inputs; score source and derived delivery live elsewhere."""

    def __init__(self, repository: FilesRepository | None = None, storage: FileStorage | None = None) -> None:
        self.repository = repository or FilesRepository()
        self.storage = storage or file_storage

    @staticmethod
    def allowed_file(filename: str) -> bool:
        return "." in filename and filename.rsplit(".", 1)[1].lower() in settings.ALLOWED_EXTENSIONS

    async def upload_file(self, db: AsyncSession, current_user: User, file: UploadFile) -> UploadFileRead:
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
        content_type = file.content_type or "application/octet-stream"
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
        blob = await self.repository.get_blob_by_sha256(db, file_hash)
        stored = None
        try:
            blob_needs_current_storage = (
                blob is None
                or blob.storage_backend != self.storage.backend_name
                or not self.storage.exists(blob.storage_key)
            )
            if blob_needs_current_storage:
                stored = self.storage.save_blob(
                    content=content,
                    sha256=file_hash,
                    extension=extension,
                    content_type=content_type,
                )
                if blob is None:
                    blob = await self.repository.create_blob(
                        db,
                        sha256=file_hash,
                        storage_backend=self.storage.backend_name,
                        storage_key=stored.storage_key,
                        filename=stored.filename,
                        size_bytes=stored.size_bytes,
                        mime_type=content_type,
                    )
                else:
                    blob = await self.repository.update_blob_storage(
                        db,
                        blob,
                        storage_backend=self.storage.backend_name,
                        storage_key=stored.storage_key,
                        filename=stored.filename,
                        size_bytes=stored.size_bytes,
                        mime_type=content_type,
                    )
            if blob is None:
                raise FileException(code=ErrorCode.FILE_SAVE_FAILED, filename=file.filename)
            persisted_blob = blob
            upload = await self.repository.create_upload(
                db,
                blob_id=require_persisted_id(persisted_blob.id, entity="storage blob"),
                original_filename=file.filename,
                uploader_user_id=user_id,
            )
            await db.commit()
            await storage_usage_service.commit_reservation(
                db,
                reservation.reservation_id,
                object_type="upload",
                object_id=upload.upload_uuid,
                storage_key=persisted_blob.storage_key,
            )
        except Exception as exc:
            await db.rollback()
            if stored is not None:
                try:
                    self.storage.delete(stored.storage_key)
                except Exception:
                    pass
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
            size=persisted_blob.size_bytes,
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
        blob = await db.get(StorageBlob, upload.blob_id)
        if blob is None:
            raise ResourceNotFoundException("storage_blob", str(upload.blob_id), ErrorCode.FILE_NOT_FOUND)
        size_bytes = blob.size_bytes
        storage_key = blob.storage_key
        upload_uuid = upload.upload_uuid
        await self.repository.delete_upload_by_id(db, require_persisted_id(upload.id, entity="upload"))
        await db.flush()
        blob_id = require_persisted_id(blob.id, entity="storage blob")
        should_delete_blob = await self.repository.blob_upload_count(db, blob_id) == 0
        if should_delete_blob:
            await self.repository.delete_blob_by_id(db, blob_id)
        await db.commit()
        await storage_usage_service.record_release(
            db,
            user_id=require_persisted_id(current_user.id, entity="user"),
            category=StorageUsageCategory.UPLOAD,
            bytes_count=size_bytes,
            reason="delete_upload",
            object_type="upload",
            object_id=upload_uuid,
            storage_key=storage_key,
        )
        if should_delete_blob:
            try:
                self.storage.delete(storage_key)
            except Exception as exc:
                raise FileException(ErrorCode.FILE_DELETE_FAILED, filename) from exc
        return DeleteUploadedFileRead(filename=filename)


files_service = FilesService()
