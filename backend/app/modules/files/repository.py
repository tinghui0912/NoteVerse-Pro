from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import File as FileModel
from app.db.models import Task, Upload

task_uuid_col = Task.__table__.c.task_uuid


class FilesRepository:
    """Data-access helpers for the files module."""

    async def upsert_upload(
        self,
        db: AsyncSession,
        *,
        sha256: str,
        stored_filename: str,
        original_filename: str,
        size_bytes: int,
        mime_type: str,
        uploader_user_id: int,
    ) -> Upload:
        upload = await self.get_upload_by_sha256(db, sha256)

        if not upload:
            upload = Upload(
                sha256=sha256,
                stored_filename=stored_filename,
                original_filename=original_filename,
                size_bytes=size_bytes,
                mime_type=mime_type,
                uploader_user_id=uploader_user_id,
            )
            db.add(upload)
            return upload

        if not upload.original_filename:
            upload.original_filename = original_filename
        if not upload.size_bytes:
            upload.size_bytes = size_bytes
        if not upload.mime_type:
            upload.mime_type = mime_type
        if not upload.uploader_user_id:
            upload.uploader_user_id = uploader_user_id

        return upload

    async def get_upload_by_sha256(
        self,
        db: AsyncSession,
        sha256: str,
    ) -> Upload | None:
        result = await db.execute(select(Upload).where(Upload.sha256 == sha256))
        return result.scalar_one_or_none()

    async def get_upload_by_stored_filename(
        self,
        db: AsyncSession,
        filename: str,
    ) -> Upload | None:
        result = await db.execute(select(Upload).where(Upload.stored_filename == filename))
        return result.scalars().first()

    async def delete_upload_by_id(
        self,
        db: AsyncSession,
        upload_id: int,
    ) -> None:
        await db.execute(delete(Upload).where(Upload.id == upload_id))

    async def get_task_by_uuid(
        self,
        db: AsyncSession,
        task_uuid: str,
    ) -> Task | None:
        result = await db.execute(select(Task).where(Task.task_uuid == task_uuid))
        return result.scalar_one_or_none()

    async def list_task_files(
        self,
        db: AsyncSession,
        task_id: int,
    ) -> list[FileModel]:
        result = await db.execute(
            select(FileModel)
            .where(FileModel.task_id == task_id)
            .order_by(FileModel.kind, FileModel.page)
        )
        return list(result.scalars().all())

    async def list_task_files_by_kind(
        self,
        db: AsyncSession,
        task_id: int,
        file_type: str,
    ) -> list[FileModel]:
        result = await db.execute(
            select(FileModel)
            .where(FileModel.task_id == task_id, FileModel.kind == file_type)
            .order_by(FileModel.page)
        )
        return list(result.scalars().all())

    async def list_export_tasks(
        self,
        db: AsyncSession,
        task_ids: list[str],
        user_id: int,
    ) -> list[Task]:
        result = await db.execute(
            select(Task).where(
                task_uuid_col.in_(task_ids),
                Task.user_id == user_id,
            )
        )
        return list(result.scalars().all())


files_repository = FilesRepository()
