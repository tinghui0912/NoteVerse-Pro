from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    ImportJobUpload,
    ScoreInputAsset,
    Upload,
    UploadCreationRequest,
)


class UploadRepository:
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

    def get_upload_by_uuid(
        self, db: Session, upload_uuid: str, *, lock: bool = False
    ) -> Upload | None:
        query = select(Upload).where(Upload.upload_uuid == upload_uuid)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return db.scalar(query)

    def creation_request(
        self, db: Session, user_id: int, key: str, *, lock: bool = False
    ) -> UploadCreationRequest | None:
        query = select(UploadCreationRequest).where(
            UploadCreationRequest.user_id == user_id, UploadCreationRequest.client_request_id == key
        )
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return db.scalar(query)

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
