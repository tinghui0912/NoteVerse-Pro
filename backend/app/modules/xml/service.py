"""XML application service under the xml module boundary."""
from __future__ import annotations

import os
import shutil
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.models import Task
from app.db.models.file import File
from app.db.models.task import TaskState
from app.db.model_utils import require_persisted_id
from app.modules.xml.fingering_service import XMLFingeringService
from app.modules.xml.render_service import XMLRenderService
from app.modules.xml.schemas import (
    XMLConfirmResult,
    XMLFingeringResult,
    XMLImageItem,
    XMLLoadResult,
    XMLSaveResult,
)
from app.storage import file_storage
from app.storage.paths import materialize_storage_key
from app.shared.constants import ErrorCode
from app.shared.file_kinds import FileKind

_FILE_TYPE_MAP: dict[str, FileKind] = {
    "current_xml": FileKind.CURRENT_XML,
    "final_xml": FileKind.FINAL_XML,
}

_SOURCE_MAP: dict[str, FileKind] = {
    "final": FileKind.FINAL_XML,
    "current": FileKind.CURRENT_XML,
}


class XMLService:
    """XML-domain application service."""

    def __init__(
        self,
        render_service: Optional[XMLRenderService] = None,
        fingering_service: Optional[XMLFingeringService] = None,
    ) -> None:
        self.render_service = render_service or XMLRenderService()
        self.fingering_service = fingering_service or XMLFingeringService()

    async def load_xml(
        self,
        db: AsyncSession,
        task_uuid: str,
        source: str = "current",
        user_id: Optional[int] = None,
    ) -> XMLLoadResult:
        task = await self._get_task(db, task_uuid)

        if user_id and task.user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_ACCESS,
                details={"task_id": task_uuid},
            )

        file_kind = _SOURCE_MAP[source]
        task_id = require_persisted_id(task.id, entity="task")
        file_record = await self._find_file(db, task_id, file_kind)

        if not file_record:
            raise ResourceNotFoundException(
                resource_type="xml",
                resource_id=task_uuid,
                code=ErrorCode.FILE_NOT_FOUND,
            )

        file_path = materialize_storage_key(file_record.storage_key)
        if not os.path.exists(file_path):
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=file_path)

        with open(file_path, "r", encoding="utf-8") as file_handle:
            content = file_handle.read()

        last_modified = os.path.getmtime(file_path)
        return {
            "content": content,
            "file_type": file_kind.value,
            "last_modified": datetime.fromtimestamp(last_modified).isoformat(),
        }

    async def save_xml(
        self,
        db: AsyncSession,
        task_uuid: str,
        user_id: int,
        content: str,
        file_type: str = "current_xml",
        image_type: Optional[str] = None,
    ) -> XMLSaveResult:
        task = await self._get_task(db, task_uuid)
        self._check_edit_access(task, user_id, task_uuid)

        file_kind = _FILE_TYPE_MAP.get(file_type, FileKind.CURRENT_XML)
        task_id = require_persisted_id(task.id, entity="task")
        xml_file = await self._find_file(db, task_id, file_kind)

        if xml_file:
            output_path = materialize_storage_key(xml_file.storage_key)
        else:
            output_dir = os.path.join(settings.WORK_ROOT, task_uuid, "xml")
            os.makedirs(output_dir, exist_ok=True)
            filename = "current.xml" if file_kind == FileKind.CURRENT_XML else "final.xml"
            output_path = os.path.join(output_dir, filename)

        with open(output_path, "w", encoding="utf-8") as file_handle:
            file_handle.write(content)

        size_bytes = os.path.getsize(output_path)
        stored_key = self._store_xml_output(task_uuid, file_kind, output_path)

        if xml_file:
            xml_file.storage_backend = file_storage.backend_name
            xml_file.storage_key = stored_key
            xml_file.filename = os.path.basename(stored_key)
            xml_file.size_bytes = size_bytes
        else:
            db.add(
                File(
                    task_id=task_id,
                    kind=file_kind,
                    storage_backend=file_storage.backend_name,
                    storage_key=stored_key,
                    filename=os.path.basename(stored_key),
                    size_bytes=size_bytes,
                    mime_type="application/xml",
                )
            )

        await db.commit()

        result: XMLSaveResult = {
            "storage_key": stored_key,
            "size_bytes": size_bytes,
        }

        if image_type:
            rendered = await self.render_service.render_images(
                db,
                task_id,
                task_uuid,
                output_path,
                image_type,
            )
            result["image_count"] = len(rendered)

        return result

    async def confirm_recognition(
        self,
        db: AsyncSession,
        task_uuid: str,
        user_id: int,
    ) -> XMLConfirmResult:
        task = await self._get_task(db, task_uuid)
        self._check_edit_access(task, user_id, task_uuid)

        task_id = require_persisted_id(task.id, entity="task")
        current_file = await self._find_file(db, task_id, FileKind.CURRENT_XML)
        if not current_file:
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename="current.xml")

        current_path = materialize_storage_key(current_file.storage_key)
        if not os.path.exists(current_path):
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=current_path)

        output_dir = os.path.join(settings.WORK_ROOT, task_uuid, "xml")
        os.makedirs(output_dir, exist_ok=True)
        final_xml_path = os.path.join(output_dir, "final.xml")
        shutil.copy2(current_path, final_xml_path)

        final_xml_key = await self._upsert_file(
            db,
            task_id,
            task_uuid,
            FileKind.FINAL_XML,
            final_xml_path,
        )

        final_images: list[XMLImageItem] = []
        rendered_paths = await self.render_service.render_images(
            db,
            task_id,
            task_uuid,
            final_xml_path,
            "final_image",
        )
        for index, path in enumerate(rendered_paths, 1):
            final_images.append({"storage_key": path, "page": index})

        task.state = TaskState.SUCCESS
        await db.commit()

        return {
            "task_id": task_uuid,
            "final_xml": final_xml_key,
            "final_images": final_images,
            "image_count": len(final_images),
        }

    async def generate_fingering(
        self,
        db: AsyncSession,
        task_uuid: str,
        user_id: int,
        hand: str = "both",
        depth: int = 6,
    ) -> XMLFingeringResult:
        task = await self._get_task(db, task_uuid)
        self._check_edit_access(task, user_id, task_uuid)

        task_id = require_persisted_id(task.id, entity="task")
        current_file = await self._find_file(db, task_id, FileKind.CURRENT_XML)
        if not current_file:
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename="current.xml")

        current_path = materialize_storage_key(current_file.storage_key)
        if not os.path.exists(current_path):
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename="current.xml")

        with open(current_path, "r", encoding="utf-8") as file_handle:
            xml_content = file_handle.read()

        return self.fingering_service.generate(task_uuid, xml_content, hand=hand, depth=depth)

    async def _get_task(self, db: AsyncSession, task_uuid: str) -> Task:
        result = await db.execute(select(Task).where(Task.task_uuid == task_uuid))
        task = result.scalar_one_or_none()
        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=task_uuid,
                code=ErrorCode.TASK_NOT_FOUND,
            )
        return task

    @staticmethod
    def _check_edit_access(task: Task, user_id: int, task_uuid: str) -> None:
        if task.user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_EDIT_ACCESS,
                details={"task_id": task_uuid},
            )

    @staticmethod
    async def _find_file(db: AsyncSession, task_id: int, kind: FileKind) -> Optional[File]:
        result = await db.execute(select(File).where(File.task_id == task_id).where(File.kind == kind))
        return result.scalar_one_or_none()

    @staticmethod
    async def _upsert_file(
        db: AsyncSession,
        task_id: int,
        task_uuid: str,
        kind: FileKind,
        file_path: str,
    ) -> str:
        result = await db.execute(select(File).where(File.task_id == task_id).where(File.kind == kind))
        existing = result.scalar_one_or_none()
        size_bytes = os.path.getsize(file_path)
        stored_key = XMLService._store_xml_output(task_uuid, kind, file_path)

        if existing:
            existing.storage_backend = file_storage.backend_name
            existing.storage_key = stored_key
            existing.filename = os.path.basename(stored_key)
            existing.size_bytes = size_bytes
        else:
            db.add(
                File(
                    task_id=task_id,
                    kind=kind,
                    storage_backend=file_storage.backend_name,
                    storage_key=stored_key,
                    filename=os.path.basename(stored_key),
                    size_bytes=size_bytes,
                    mime_type="application/xml",
                )
            )
        return stored_key

    @staticmethod
    def _store_xml_output(task_uuid: str, kind: FileKind, file_path: str) -> str:
        if not task_uuid:
            parent = os.path.basename(os.path.dirname(file_path))
            task_uuid = parent or "unknown"
        key = f"tasks/{task_uuid}/{kind.value}/{os.path.basename(file_path)}"
        with open(file_path, "rb") as file_handle:
            stored = file_storage.put_bytes(
                key=key,
                content=file_handle.read(),
                content_type="application/xml",
            )
        return stored.storage_key


xml_service = XMLService()
