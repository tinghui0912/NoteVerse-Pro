"""Uploader-owned semantic erasure; caller owns the transaction."""

from app.modules.account.resource_users import resource_user_query

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.shared.integrity import ResourceIntegrityError
from app.db.models import Upload, UploadCreationRequest, User
from app.modules.storage_governance.usage.service import StorageUsageService
from .service import UploadService


def has_account_uploads(db: Session, user_id: int) -> bool:
    return (
        db.scalar(select(Upload.id).where(Upload.uploader_user_id == user_id).limit(1)) is not None
    )


def cleanup_account_upload(
    db: Session, user_id: int, *, usage: StorageUsageService, uploads: UploadService
) -> bool:
    usage.committed_bytes(db, user_id, lock=True)
    upload = db.scalar(
        select(Upload).where(Upload.uploader_user_id == user_id).order_by(Upload.id).limit(1)
    )
    if upload is None:
        return False
    user = db.scalar(resource_user_query().where(User.id == user_id))
    if user is None or user.deleted_at is None:
        raise ResourceIntegrityError("Upload erasure requires its closed owner")
    uploads.delete_upload(db, user, upload.upload_uuid)
    return True


def erase_account_upload_history(db: Session, user_id: int, *, limit: int) -> bool:
    if has_account_uploads(db, user_id):
        raise ResourceIntegrityError("Upload history still has semantic resources")
    ids = list(
        db.scalars(
            select(UploadCreationRequest.id)
            .where(UploadCreationRequest.user_id == user_id)
            .order_by(UploadCreationRequest.id)
            .limit(limit)
        )
    )
    if not ids:
        return False
    db.execute(delete(UploadCreationRequest).where(UploadCreationRequest.id.in_(ids)))
    return True
