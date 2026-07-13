import hashlib

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import FileException, ResourceNotFoundException, UnauthorizedException, ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.files.repository import FilesRepository
from app.modules.files.schemas import DeleteUploadedFileResult, UploadFileResult
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

    async def upload_file(self, db: AsyncSession, current_user: User, file: UploadFile) -> UploadFileResult:
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
        try:
            stored = self.storage.save_score_upload(content=content, sha256=file_hash, extension=extension)
        except Exception as exc:
            raise FileException(
                code=ErrorCode.FILE_SAVE_FAILED,
                filename=file.filename,
                details={"error": str(exc)},
            ) from exc
        await self.repository.upsert_upload(
            db,
            sha256=file_hash,
            storage_backend=self.storage.backend_name,
            storage_key=stored.storage_key,
            filename=stored.filename,
            original_filename=file.filename,
            size_bytes=stored.size_bytes,
            mime_type=file.content_type or "application/octet-stream",
            uploader_user_id=require_persisted_id(current_user.id, entity="user"),
        )
        await db.commit()
        return {"file_id": file_hash, "filename": file.filename, "storage_key": stored.storage_key, "size": stored.size_bytes}

    async def delete_uploaded_file(
        self, db: AsyncSession, current_user: User, filename: str
    ) -> DeleteUploadedFileResult:
        upload = await self.repository.get_upload_by_filename(db, filename)
        if not upload:
            raise ResourceNotFoundException("file", filename, ErrorCode.FILE_NOT_FOUND)
        if upload.uploader_user_id != current_user.id:
            raise UnauthorizedException(ErrorCode.NO_DELETE_ACCESS, {"filename": filename})
        try:
            self.storage.delete(upload.storage_key)
        except Exception as exc:
            raise FileException(ErrorCode.FILE_DELETE_FAILED, filename, {"error": str(exc)}) from exc
        await self.repository.delete_upload_by_id(db, require_persisted_id(upload.id, entity="upload"))
        await db.commit()
        return {"filename": filename}


files_service = FilesService()
