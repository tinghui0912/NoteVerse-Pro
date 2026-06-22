from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Upload


class FilesRepository:
    async def upsert_upload(
        self,
        db: AsyncSession,
        *,
        sha256: str,
        storage_backend: str,
        storage_key: str,
        filename: str,
        original_filename: str,
        size_bytes: int,
        mime_type: str,
        uploader_user_id: int,
    ) -> Upload:
        upload = await self.get_upload_by_sha256(db, sha256)
        if not upload:
            upload = Upload(
                sha256=sha256,
                storage_backend=storage_backend,
                storage_key=storage_key,
                filename=filename,
                original_filename=original_filename,
                size_bytes=size_bytes,
                mime_type=mime_type,
                uploader_user_id=uploader_user_id,
            )
            db.add(upload)
            return upload
        upload.storage_backend = storage_backend
        upload.storage_key = storage_key
        upload.filename = filename
        upload.original_filename = upload.original_filename or original_filename
        upload.size_bytes = upload.size_bytes or size_bytes
        upload.mime_type = upload.mime_type or mime_type
        upload.uploader_user_id = upload.uploader_user_id or uploader_user_id
        return upload

    async def get_upload_by_sha256(self, db: AsyncSession, sha256: str) -> Upload | None:
        return (await db.execute(select(Upload).where(Upload.sha256 == sha256))).scalar_one_or_none()

    async def get_upload_by_filename(self, db: AsyncSession, filename: str) -> Upload | None:
        return (await db.execute(select(Upload).where(Upload.filename == filename))).scalars().first()

    async def delete_upload_by_id(self, db: AsyncSession, upload_id: int) -> None:
        await db.execute(delete(Upload).where(Upload.id == upload_id))


files_repository = FilesRepository()
