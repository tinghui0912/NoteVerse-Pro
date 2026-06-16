import hashlib
import io
import os
import time
from dataclasses import dataclass
from urllib.parse import urlencode

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.constants import ErrorCode
from app.core.config import settings
from app.core.logger import logger
from app.core.exceptions import (
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.models import Task, User
from app.db.model_utils import require_persisted_id
from app.modules.files.repository import FilesRepository
from app.modules.files.schemas import (
    DeleteUploadedFileResult,
    ExportTasksExcelRequest,
    TaskFileListItem,
    TaskFilesResult,
    UploadFileResult,
)
from app.storage import FileStorage, file_storage
from app.utils.permissions import check_task_view_access


@dataclass(frozen=True)
class FileDelivery:
    """How a file should be delivered to the client."""

    filename: str
    media_type: str
    path: str | None = None
    redirect_url: str | None = None


class FilesService:
    """Feature service for file upload, listing, and export flows."""

    def __init__(
        self,
        repository: FilesRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or FilesRepository()
        self.storage = storage or file_storage

    @staticmethod
    def allowed_file(filename: str) -> bool:
        if "." not in filename:
            return False
        ext = filename.rsplit(".", 1)[1].lower()
        return ext in settings.ALLOWED_EXTENSIONS

    async def upload_file(
        self,
        db: AsyncSession,
        current_user: User,
        file: UploadFile,
    ) -> UploadFileResult:
        if not file.filename:
            raise ValidationException(code=ErrorCode.NO_FILE_SELECTED, field="file")

        if not self.allowed_file(file.filename):
            raise ValidationException(
                code=ErrorCode.FILE_TYPE_NOT_ALLOWED,
                field="file",
                details={"allowed": list(settings.ALLOWED_EXTENSIONS)},
            )

        sha256_hash = hashlib.sha256()
        content = await file.read()
        sha256_hash.update(content)
        file_hash = sha256_hash.hexdigest()
        await file.seek(0)

        ext = ""
        if "." in file.filename:
            ext = "." + file.filename.rsplit(".", 1)[1].lower()

        try:
            stored = self.storage.save_score_upload(
                content=content,
                sha256=file_hash,
                extension=ext,
            )
        except Exception as exc:
            raise FileException(
                code=ErrorCode.FILE_SAVE_FAILED,
                filename=file.filename,
                details={"error": str(exc)},
            )

        uploader_user_id = require_persisted_id(current_user.id, entity="user")

        await self.repository.upsert_upload(
            db,
            sha256=file_hash,
            storage_backend=settings.FILE_STORAGE_BACKEND,
            storage_key=stored.storage_key,
            filename=stored.filename,
            original_filename=file.filename,
            size_bytes=stored.size_bytes,
            mime_type=file.content_type or "",
            uploader_user_id=uploader_user_id,
        )

        await db.commit()

        return {
            "file_id": file_hash,
            "filename": file.filename,
            "storage_key": stored.storage_key,
            "size": stored.size_bytes,
        }

    async def list_task_files(
        self,
        db: AsyncSession,
        task: Task,
    ) -> TaskFilesResult:
        task_id = require_persisted_id(task.id, entity="task")
        files = await self.repository.list_task_files(db, task_id)

        categorized: dict[str, list[TaskFileListItem]] = {}
        for file in files:
            categorized.setdefault(file.kind, []).append(
                {
                    "storage_key": file.storage_key,
                    "filename": file.filename,
                    "page_number": file.page_number,
                    "size": file.size_bytes,
                    "mime_type": file.mime_type,
                    "created_at": file.created_at.isoformat() if file.created_at else None,
                }
            )

        return {"task_id": task.task_uuid, "files": categorized}

    async def download_task_file(
        self,
        db: AsyncSession,
        current_user: User,
        task_id: str,
        file_type: str,
        page: int,
        share_token: str | None = None,
    ) -> FileDelivery:
        task = await self.repository.get_task_by_uuid(db, task_id)

        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=task_id,
                code=ErrorCode.TASK_NOT_FOUND,
            )

        has_access = await check_task_view_access(db, task, current_user, share_token)
        if not has_access:
            raise UnauthorizedException(
                code=ErrorCode.NO_ACCESS,
                details={"task_id": task_id},
            )

        task_id_db = require_persisted_id(task.id, entity="task")
        files = await self.repository.list_task_files_by_kind(db, task_id_db, file_type)

        if not files:
            raise ResourceNotFoundException(
                resource_type=file_type,
                resource_id=task_id,
                code=ErrorCode.FILE_NOT_FOUND,
            )

        page_index = max(0, min(len(files) - 1, page - 1))
        target_file = files[page_index]
        filename = target_file.filename
        media_type = target_file.mime_type or "application/octet-stream"
        if self.storage.backend_name != "local":
            redirect_url = self._signed_storage_url(
                target_file.storage_key,
                filename=filename,
                media_type=media_type,
            )
            return FileDelivery(
                redirect_url=redirect_url,
                filename=filename,
                media_type=media_type,
            )

        file_path = self.storage.materialize_to_local(
            target_file.storage_key,
            self.storage.local_path(target_file.storage_key),
        )

        if not os.path.exists(file_path):
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=file_path)

        return FileDelivery(
            path=file_path,
            filename=os.path.basename(file_path),
            media_type=media_type,
        )

    async def get_task_file_access_url(
        self,
        db: AsyncSession,
        current_user: User,
        task_id: str,
        file_type: str,
        page: int,
        share_token: str | None = None,
    ) -> dict[str, str | int | None]:
        """Return an authenticated inline URL for browser image/media display."""
        task = await self.repository.get_task_by_uuid(db, task_id)

        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=task_id,
                code=ErrorCode.TASK_NOT_FOUND,
            )

        has_access = await check_task_view_access(db, task, current_user, share_token)
        if not has_access:
            raise UnauthorizedException(
                code=ErrorCode.NO_ACCESS,
                details={"task_id": task_id},
            )

        task_id_db = require_persisted_id(task.id, entity="task")
        files = await self.repository.list_task_files_by_kind(db, task_id_db, file_type)

        if not files:
            raise ResourceNotFoundException(
                resource_type=file_type,
                resource_id=task_id,
                code=ErrorCode.FILE_NOT_FOUND,
            )

        page_index = max(0, min(len(files) - 1, page - 1))
        target_file = files[page_index]
        media_type = target_file.mime_type or "application/octet-stream"
        url = self._inline_access_url(
            target_file.storage_key,
            file_type=file_type,
            task_id=task_id,
            page=page,
            share_token=share_token,
            media_type=media_type,
        )

        return {
            "url": url,
            "filename": target_file.filename,
            "mime_type": media_type,
            "expires_in": settings.S3_PRESIGN_EXPIRE_SECONDS
            if self.storage.backend_name != "local"
            else None,
        }

    async def delete_uploaded_file(
        self,
        db: AsyncSession,
        current_user: User,
        filename: str,
    ) -> DeleteUploadedFileResult:
        upload = await self.repository.get_upload_by_filename(db, filename)

        if not upload:
            raise ResourceNotFoundException(
                resource_type="file",
                resource_id=filename,
                code=ErrorCode.FILE_NOT_FOUND,
            )

        if upload.uploader_user_id != current_user.id:
            raise UnauthorizedException(
                code=ErrorCode.NO_DELETE_ACCESS,
                details={"filename": filename},
            )

        try:
            self.storage.delete(upload.storage_key)
        except Exception as exc:
            raise FileException(
                code=ErrorCode.FILE_DELETE_FAILED,
                filename=filename,
                details={"error": str(exc)},
            )

        upload_id = require_persisted_id(upload.id, entity="upload")
        await self.repository.delete_upload_by_id(db, upload_id)
        await db.commit()
        return {"filename": filename}

    def preview_file(self, filename: str) -> FileDelivery:
        if not self.storage.score_upload_exists(filename):
            raise ResourceNotFoundException(
                resource_type="file",
                resource_id=filename,
                code=ErrorCode.FILE_NOT_FOUND,
            )

        import mimetypes

        mime_type, _ = mimetypes.guess_type(filename)
        media_type = mime_type or "application/octet-stream"
        storage_key = f"scores/{filename}"
        if self.storage.backend_name != "local":
            redirect_url = self._signed_storage_url(
                storage_key,
                filename=filename,
                media_type=media_type,
            )
            return FileDelivery(
                redirect_url=redirect_url,
                filename=filename,
                media_type=media_type,
            )

        return FileDelivery(
            path=self.storage.score_upload_path(filename),
            filename=filename,
            media_type=media_type,
        )

    def _signed_storage_url(
        self,
        storage_key: str,
        *,
        filename: str,
        media_type: str,
    ) -> str:
        try:
            if not self.storage.exists(storage_key):
                raise FileNotFoundError(storage_key)
            signed_url = self.storage.download_url(
                storage_key,
                filename=filename,
                content_type=media_type,
            )
            if not signed_url:
                raise FileNotFoundError(storage_key)
            return signed_url
        except FileNotFoundError:
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=storage_key)

    def _inline_access_url(
        self,
        storage_key: str,
        *,
        file_type: str,
        task_id: str,
        page: int,
        share_token: str | None,
        media_type: str,
    ) -> str:
        if self.storage.backend_name != "local":
            try:
                if not self.storage.exists(storage_key):
                    raise FileNotFoundError(storage_key)
                signed_url = self.storage.download_url(storage_key)
                if not signed_url:
                    raise FileNotFoundError(storage_key)
                return signed_url
            except FileNotFoundError:
                raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=storage_key)

        query_params = {"page": str(page)}
        if share_token:
            query_params["share_token"] = share_token
        query = urlencode(query_params)
        return f"{settings.API_V1_STR}/files/download/{file_type}/{task_id}?{query}"

    async def export_tasks_excel(
        self,
        db: AsyncSession,
        current_user: User,
        request: ExportTasksExcelRequest,
    ) -> tuple[io.BytesIO, str]:
        try:
            import openpyxl
            from openpyxl.styles import Alignment, Font
        except ImportError:
            raise FileException(code=ErrorCode.EXCEL_NOT_AVAILABLE, filename="export")

        user_id = require_persisted_id(current_user.id, entity="user")
        tasks = await self.repository.list_export_tasks(db, request.task_ids, user_id)

        if not tasks:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=",".join(request.task_ids),
                code=ErrorCode.TASK_NOT_FOUND,
            )

        workbook = openpyxl.Workbook()
        worksheet = workbook.active
        worksheet.title = "Tasks"
        worksheet.append(["Task ID", "State", "Progress", "Created At", "Finished At", "Error"])

        for cell in worksheet[1]:
            cell.font = Font(bold=True)
            cell.alignment = Alignment(horizontal="center")

        for task in tasks:
            worksheet.append(
                [
                    task.task_uuid,
                    task.state,
                    task.progress or 0,
                    task.created_at.isoformat() if task.created_at else "",
                    task.finished_at.isoformat() if task.finished_at else "",
                    task.error or "",
                ]
            )

        for column in worksheet.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    max_length = max(max_length, len(str(cell.value)))
                except Exception as exc:
                    logger.debug(
                        f"Failed to measure Excel cell width for column {column_letter}: {exc}"
                    )
            worksheet.column_dimensions[column_letter].width = min(max_length + 2, 50)

        excel_file = io.BytesIO()
        workbook.save(excel_file)
        excel_file.seek(0)

        filename = f"{settings.PROJECT_NAME.lower().replace(' ', '-')}-tasks-{int(time.time())}.xlsx"
        return excel_file, filename


files_service = FilesService()
