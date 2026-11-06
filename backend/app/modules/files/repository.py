from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ImportJobUpload, ScoreInputAsset, StoredObject, Upload


class FilesRepository:
    async def get_upload_object_by_sha256(
        self, db: AsyncSession, sha256: str
    ) -> StoredObject | None:
        # Upload-domain reuse only; other domains' identical bytes are not candidates.
        return (
            await db.execute(
                select(StoredObject)
                .join(Upload, Upload.stored_object_id == StoredObject.id)
                .where(StoredObject.sha256 == sha256)
                .order_by(StoredObject.id)
                .limit(1)
            )
        ).scalar_one_or_none()

    async def get_object_by_key(self, db: AsyncSession, key: str) -> StoredObject | None:
        return (
            await db.execute(select(StoredObject).where(StoredObject.object_key == key))
        ).scalar_one_or_none()

    async def create_upload(
        self,
        db: AsyncSession,
        *,
        stored_object_id: int,
        original_filename: str,
        uploader_user_id: int,
    ) -> Upload:
        upload = Upload(
            stored_object_id=stored_object_id,
            original_filename=original_filename,
            uploader_user_id=uploader_user_id,
        )
        db.add(upload)
        await db.flush()
        return upload

    async def get_upload_by_uuid(self, db: AsyncSession, upload_uuid: str) -> Upload | None:
        return (
            await db.execute(select(Upload).where(Upload.upload_uuid == upload_uuid))
        ).scalar_one_or_none()

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

    async def object_upload_count(self, db: AsyncSession, stored_object_id: int) -> int:
        return int(
            (
                await db.execute(
                    select(func.count(Upload.id)).where(Upload.stored_object_id == stored_object_id)
                )
            ).scalar_one()
        )

    async def delete_upload_by_id(self, db: AsyncSession, upload_id: int) -> None:
        await db.execute(delete(Upload).where(Upload.id == upload_id))

    async def delete_object_by_id(self, db: AsyncSession, stored_object_id: int) -> None:
        await db.execute(delete(StoredObject).where(StoredObject.id == stored_object_id))


files_repository = FilesRepository()
