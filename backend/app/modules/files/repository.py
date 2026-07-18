from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ImportJobUpload, ScoreInputAsset, StorageBlob, Upload


class FilesRepository:
    async def get_blob_by_sha256(self, db: AsyncSession, sha256: str) -> StorageBlob | None:
        return (await db.execute(select(StorageBlob).where(StorageBlob.sha256 == sha256))).scalar_one_or_none()

    async def create_blob(
        self,
        db: AsyncSession,
        *,
        sha256: str,
        storage_backend: str,
        storage_key: str,
        filename: str,
        size_bytes: int,
        mime_type: str,
    ) -> StorageBlob:
        blob = StorageBlob(
            sha256=sha256,
            storage_backend=storage_backend,
            storage_key=storage_key,
            filename=filename,
            size_bytes=size_bytes,
            mime_type=mime_type,
        )
        db.add(blob)
        await db.flush()
        return blob

    async def update_blob_storage(
        self,
        db: AsyncSession,
        blob: StorageBlob,
        *,
        storage_backend: str,
        storage_key: str,
        filename: str,
        size_bytes: int,
        mime_type: str,
    ) -> StorageBlob:
        blob.storage_backend = storage_backend
        blob.storage_key = storage_key
        blob.filename = filename
        blob.size_bytes = size_bytes
        blob.mime_type = mime_type
        await db.flush()
        return blob

    async def create_upload(
        self,
        db: AsyncSession,
        *,
        blob_id: int,
        original_filename: str,
        uploader_user_id: int,
    ) -> Upload:
        upload = Upload(
            blob_id=blob_id,
            original_filename=original_filename,
            uploader_user_id=uploader_user_id,
        )
        db.add(upload)
        await db.flush()
        return upload

    async def get_upload_by_uuid(self, db: AsyncSession, upload_uuid: str) -> Upload | None:
        return (await db.execute(select(Upload).where(Upload.upload_uuid == upload_uuid))).scalar_one_or_none()

    async def upload_reference_count(self, db: AsyncSession, upload_id: int) -> int:
        import_refs = (
            await db.execute(
                select(func.count(ImportJobUpload.id)).where(ImportJobUpload.upload_id == upload_id)
            )
        ).scalar_one()
        input_refs = (
            await db.execute(
                select(func.count(ScoreInputAsset.id)).where(ScoreInputAsset.upload_id == upload_id)
            )
        ).scalar_one()
        return int(import_refs) + int(input_refs)

    async def blob_upload_count(self, db: AsyncSession, blob_id: int) -> int:
        return int((await db.execute(select(func.count(Upload.id)).where(Upload.blob_id == blob_id))).scalar_one())

    async def delete_upload_by_id(self, db: AsyncSession, upload_id: int) -> None:
        await db.execute(delete(Upload).where(Upload.id == upload_id))

    async def delete_blob_by_id(self, db: AsyncSession, blob_id: int) -> None:
        await db.execute(delete(StorageBlob).where(StorageBlob.id == blob_id))


files_repository = FilesRepository()
