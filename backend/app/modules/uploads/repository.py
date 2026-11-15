from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import ImportJobUpload, ScoreInputAsset, StoredObject, Upload


class UploadRepository:
    def get_upload_object_by_sha256(self, db: Session, sha256: str) -> StoredObject | None:
        # Upload-domain reuse only; other domains' identical bytes are not candidates.
        return (
            db.execute(
                select(StoredObject)
                .join(Upload, Upload.stored_object_id == StoredObject.id)
                .where(StoredObject.sha256 == sha256)
                .order_by(StoredObject.id)
                .limit(1)
            )
        ).scalar_one_or_none()

    def get_object_by_key(self, db: Session, key: str) -> StoredObject | None:
        return (
            db.execute(select(StoredObject).where(StoredObject.object_key == key))
        ).scalar_one_or_none()

    def create_upload(
        self,
        db: Session,
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
        db.flush()
        return upload

    def get_upload_by_uuid(self, db: Session, upload_uuid: str) -> Upload | None:
        return (
            db.execute(select(Upload).where(Upload.upload_uuid == upload_uuid))
        ).scalar_one_or_none()

    def upload_reference_count(self, db: Session, upload_id: int) -> int:
        import_refs = (
            db.execute(
                select(func.count(ImportJobUpload.id)).where(ImportJobUpload.upload_id == upload_id)
            )
        ).scalar_one()
        input_refs = (
            db.execute(
                select(func.count(ScoreInputAsset.id)).where(ScoreInputAsset.upload_id == upload_id)
            )
        ).scalar_one()
        return int(import_refs) + int(input_refs)

    def delete_upload_by_id(self, db: Session, upload_id: int) -> None:
        db.execute(delete(Upload).where(Upload.id == upload_id))


upload_repository = UploadRepository()
