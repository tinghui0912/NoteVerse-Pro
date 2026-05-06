"""Archive-export helpers for task download workflows."""
from __future__ import annotations

import os
import time
import zipfile
from io import BytesIO
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import FileException, ResourceNotFoundException
from app.core.logger import logger
from app.db.models import File as FileModel
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.tasks.repository import TaskRepository
from app.modules.tasks.schemas import BatchArchiveRequestLike
from app.shared.constants import ErrorCode
from app.shared.file_kinds import FileKind
from app.utils.paths import resolve_stored_path
from app.utils.permissions import get_accessible_tasks


class TaskArchiveService:
    """Build downloadable task archives for the tasks module."""

    def __init__(self, repository: TaskRepository | None = None) -> None:
        self.repository = repository or TaskRepository()

    async def build_archive(
        self,
        db: AsyncSession,
        current_user: User,
        request: BatchArchiveRequestLike,
    ) -> tuple[BytesIO, str, int, int]:
        tasks = await get_accessible_tasks(db, current_user, request.task_ids)

        if not tasks:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=",".join(request.task_ids),
                code=ErrorCode.TASK_NOT_FOUND,
            )

        task_ids = [require_persisted_id(task.id, entity="task") for task in tasks]
        files_by_task = await self.repository.list_files_for_tasks(db, task_ids)

        archive_stream = BytesIO()
        downloaded_count = 0
        skipped_count = 0

        with zipfile.ZipFile(archive_stream, "w", zipfile.ZIP_DEFLATED) as archive:
            for task in tasks:
                task_id = require_persisted_id(task.id, entity="task")
                files = files_by_task.get(task_id, [])
                if not self._has_final_exportables(files):
                    skipped_count += 1
                    continue

                downloaded_count += 1
                self._write_task_archive_entries(
                    archive,
                    task.task_uuid,
                    files,
                    include_types=request.include_types,
                )

        archive_stream.seek(0)
        filename = (
            f"{settings.PROJECT_NAME.lower().replace(' ', '-')}-tasks-{int(time.time())}.zip"
        )
        return archive_stream, filename, downloaded_count, skipped_count

    @staticmethod
    def _has_final_exportables(files: List[FileModel]) -> bool:
        return any(
            file.kind == FileKind.FINAL_IMAGE or file.kind == FileKind.FINAL_XML
            for file in files
        )

    @staticmethod
    def _write_task_archive_entries(
        archive: zipfile.ZipFile,
        task_uuid: str,
        files: List[FileModel],
        include_types: List[str],
    ) -> None:
        if "png" in include_types:
            for file in files:
                if file.kind == FileKind.FINAL_IMAGE and file.mime_type == "image/png":
                    TaskArchiveService._write_archive_file(
                        archive,
                        file,
                        arcname=f"{task_uuid}/page-{file.page or 1:02d}.png",
                    )

        if "xml" in include_types:
            for file in files:
                if file.kind == FileKind.FINAL_XML:
                    TaskArchiveService._write_archive_file(
                        archive,
                        file,
                        arcname=f"{task_uuid}/final.xml",
                    )

    @staticmethod
    def _write_archive_file(
        archive: zipfile.ZipFile,
        file: FileModel,
        arcname: str,
    ) -> None:
        try:
            file_path = resolve_stored_path(file.path)
            if not os.path.exists(file_path):
                raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=file_path)
            archive.write(file_path, arcname)
        except Exception as exc:
            logger.debug(f"Skipping archive file {arcname}: {exc}")


task_archive_service = TaskArchiveService()
