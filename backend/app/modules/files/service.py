import glob
import hashlib
import io
import os
import time

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
from app.utils.paths import resolve_stored_path
from app.utils.permissions import check_task_view_access


class FilesService:
    """Feature service for file upload, listing, and export flows."""

    def __init__(self, repository: FilesRepository | None = None) -> None:
        self.repository = repository or FilesRepository()

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

        upload_dir = os.path.join(settings.UPLOAD_FOLDER, "scores")
        os.makedirs(upload_dir, exist_ok=True)

        ext = ""
        if "." in file.filename:
            ext = "." + file.filename.rsplit(".", 1)[1].lower()

        existing_files = glob.glob(os.path.join(upload_dir, f"{file_hash}.*"))
        if existing_files:
            stored_path = existing_files[0]
        else:
            stored_name = f"{file_hash}{ext}"
            stored_path = os.path.join(upload_dir, stored_name)
            try:
                with open(stored_path, "wb") as file_handle:
                    file_handle.write(content)
            except Exception as exc:
                raise FileException(
                    code=ErrorCode.FILE_SAVE_FAILED,
                    filename=file.filename,
                    details={"error": str(exc)},
                )

        file_size = os.path.getsize(stored_path)
        uploader_user_id = require_persisted_id(current_user.id, entity="user")

        await self.repository.upsert_upload(
            db,
            sha256=file_hash,
            stored_filename=os.path.basename(stored_path),
            original_filename=file.filename,
            size_bytes=file_size,
            mime_type=file.content_type or "",
            uploader_user_id=uploader_user_id,
        )

        await db.commit()

        return {
            "file_id": file_hash,
            "filename": file.filename,
            "stored_filename": os.path.basename(stored_path),
            "size": file_size,
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
                    "path": file.path,
                    "page": file.page,
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
    ) -> tuple[str, str, str]:
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
        file_path = resolve_stored_path(target_file.path)

        if not os.path.exists(file_path):
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=file_path)

        return file_path, os.path.basename(file_path), target_file.mime_type or "application/octet-stream"

    async def delete_uploaded_file(
        self,
        db: AsyncSession,
        current_user: User,
        filename: str,
    ) -> DeleteUploadedFileResult:
        upload = await self.repository.get_upload_by_stored_filename(db, filename)

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

        file_path = os.path.join(settings.UPLOAD_FOLDER, "scores", filename)
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
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

    def preview_file(self, filename: str) -> tuple[str, str, str]:
        file_path = os.path.join(settings.UPLOAD_FOLDER, "scores", filename)
        if not os.path.exists(file_path):
            raise ResourceNotFoundException(
                resource_type="file",
                resource_id=filename,
                code=ErrorCode.FILE_NOT_FOUND,
            )

        import mimetypes

        mime_type, _ = mimetypes.guess_type(filename)
        return file_path, filename, mime_type or "application/octet-stream"

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
