"""Score-import commands atomically compose upload sessions, capacity and semantic usage."""

from hashlib import sha256
import json
from pathlib import PurePath
from uuid import uuid4
from sqlalchemy.orm import Session
from app.db.models import UploadCreationRequest, Upload, User, StoredObject
from app.db.model_utils import require_persisted_id
from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.modules.storage_governance.usage.service import StorageUsageService
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.media_storage.upload_sessions.service import UploadSessionService, lock_upload_user
from app.modules.media_storage.upload_sessions.domain import UploadPurpose
from app.modules.media_storage.upload_sessions.schemas import UploadCreateRequest
from app.modules.media_storage.retirement import retire_after_release
from .repository import UploadRepository
from .schemas import UploadRead, UploadAdmissionRead
from .upload_admission import admit_score_import_image, SCORE_IMPORT_IMAGES


class UploadService:
    def __init__(
        self,
        *,
        quota: StorageQuotaService,
        usage: StorageUsageService,
        uploads: UploadSessionService,
        repository: UploadRepository | None = None,
    ) -> None:
        self.quota, self.usage, self.uploads = quota, usage, uploads
        self.repository = repository or UploadRepository()

    def create_request(
        self, db: Session, user_id: int, request: UploadCreateRequest
    ) -> UploadAdmissionRead:
        descriptor = next(
            (
                item
                for item in SCORE_IMPORT_IMAGES
                if request.content_type == item.mime_type
                and PurePath(request.filename).suffix.lower() in item.aliases
            ),
            None,
        )
        if (
            descriptor is None
            or any(character in request.filename for character in ("/", "\\"))
            or any(ord(character) < 32 for character in request.filename)
        ):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="filename")
        self.uploads.policy.mode_for(
            UploadPurpose.SCORE_IMPORT, request.byte_size, request.content_type
        )
        fingerprint = sha256(
            json.dumps(
                [request.filename, request.byte_size, request.content_type], separators=(",", ":")
            ).encode()
        ).hexdigest()
        lock_upload_user(db, user_id)
        self.quota.lock_user(db, user_id)
        row = self.repository.creation_request(db, user_id, request.client_request_id, lock=True)
        if row is not None:
            if row.request_fingerprint != fingerprint:
                raise ConflictException(
                    CustomerErrorCode.VALIDATION_ERROR, {"reason": "upload_request_conflict"}
                )
            upload = self._creation_result(db, row) if row.completed_at is not None else None
            from app.db.models.upload_session import UploadSession

            session = db.get(UploadSession, row.upload_session_id)
            if session is None:
                raise RuntimeError("Upload request lost its physical session")
        else:
            session = self.uploads.admit(
                db,
                user_id=user_id,
                purpose=UploadPurpose.SCORE_IMPORT,
                byte_size=request.byte_size,
                content_type=request.content_type,
                final_key=f"uploads/{user_id}/{uuid4()}/input{descriptor.extension}",
            )
            hold = self.quota.create_hold(
                db,
                user_id=user_id,
                category=StorageUsageCategory.UPLOAD,
                bytes_count=request.byte_size,
                command_key="upload:" + request.client_request_id,
                expires_at=session.expires_at,
            )
            row = UploadCreationRequest(
                original_filename=request.filename,
                user_id=user_id,
                client_request_id=request.client_request_id,
                request_fingerprint=fingerprint,
                quota_hold_id=hold.hold_id,
                upload_session_id=session.id,
            )
            db.add(row)
            db.flush()
            upload = None
        uuid = session.session_uuid
        db.commit()
        db.close()
        transfer = (
            self.uploads.read(uuid, user_id)
            if upload is not None
            else self.uploads.start(uuid, user_id)
        )
        return UploadAdmissionRead(
            client_request_id=request.client_request_id, upload_session=transfer, upload=upload
        )

    def cancel_request(self, db: Session, user_id: int, session_id: str) -> None:
        from sqlalchemy import select
        from app.db.models.upload_session import UploadSession

        lock_upload_user(db, user_id)
        self.quota.lock_user(db, user_id)
        row = db.scalar(
            select(UploadCreationRequest)
            .join(UploadSession, UploadSession.id == UploadCreationRequest.upload_session_id)
            .where(
                UploadSession.session_uuid == session_id, UploadCreationRequest.user_id == user_id
            )
            .with_for_update(of=UploadCreationRequest)
        )
        if row is None or row.completed_at is not None:
            raise ValueError("Upload request does not permit cancellation")
        self.uploads.cancel(db, row.upload_session_id)
        self.quota.release_hold(db, row.quota_hold_id)

    def finalize_upload(self, db: Session, user_id: int, session_id: str) -> UploadRead:
        from sqlalchemy import select
        from app.db.models.upload_session import UploadSession

        row = db.scalar(
            select(UploadCreationRequest)
            .join(UploadSession, UploadSession.id == UploadCreationRequest.upload_session_id)
            .where(
                UploadSession.session_uuid == session_id, UploadCreationRequest.user_id == user_id
            )
        )
        if row is None:
            raise ResourceNotFoundException("upload_request", session_id)
        if row.completed_at is not None:
            return self._creation_result(db, row)
        filename = row.original_filename
        db.commit()
        db.close()
        content = self.uploads.verified_bytes(session_id, user_id, UploadPurpose.SCORE_IMPORT)
        media = admit_score_import_image(content, filename)
        self.uploads.prepare_adoption(session_id, user_id, UploadPurpose.SCORE_IMPORT)
        try:
            lock_upload_user(db, user_id)
            self.quota.lock_user(db, user_id)
            row = db.scalar(
                select(UploadCreationRequest)
                .join(UploadSession, UploadSession.id == UploadCreationRequest.upload_session_id)
                .where(
                    UploadSession.session_uuid == session_id,
                    UploadCreationRequest.user_id == user_id,
                )
                .with_for_update(of=UploadCreationRequest)
                .execution_options(populate_existing=True)
            )
            if row is None:
                raise ResourceNotFoundException("upload_request", session_id)
            if row.completed_at is not None:
                result = self._creation_result(db, row)
            else:
                transfer = db.get(UploadSession, row.upload_session_id)
                if transfer is None or media.mime_type != transfer.expected_content_type:
                    raise ValueError("Upload image type does not match its declaration")
                obj = self.uploads.consume(
                    db, uuid=session_id, user_id=user_id, purpose=UploadPurpose.SCORE_IMPORT
                )
                if not self.quota.consume_hold(db, row.quota_hold_id):
                    raise ValueError("New upload requires an unconsumed hold")
                upload = self.repository.create_upload(
                    db,
                    stored_object_id=obj.id,
                    upload_session_id=row.upload_session_id,
                    original_filename=filename,
                    uploader_user_id=user_id,
                )
                self.usage.record_allocation(
                    db,
                    user_id=user_id,
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=obj.byte_size,
                    reason="upload_created",
                    object_type="upload",
                    object_id=upload.upload_uuid,
                    storage_key=obj.object_key,
                )
                row.upload_id, row.completed_at, row.updated_at = upload.id, utc_now(), utc_now()
                result = self._creation_result(db, row)
            db.commit()
            return result
        except BaseException:
            db.rollback()
            db.close()
            with self.uploads.sessions() as recovery:
                current = recovery.scalar(
                    select(UploadCreationRequest)
                    .join(
                        UploadSession, UploadSession.id == UploadCreationRequest.upload_session_id
                    )
                    .where(
                        UploadSession.session_uuid == session_id,
                        UploadCreationRequest.user_id == user_id,
                    )
                )
                if current is not None and current.completed_at is not None:
                    return self._creation_result(recovery, current)
            raise

    @staticmethod
    def _creation_result(db: Session, request: UploadCreationRequest) -> UploadRead:
        upload = db.get(Upload, request.upload_id) if request.upload_id is not None else None
        if upload is None:
            raise ResourceNotFoundException(
                "upload", request.client_request_id, CustomerErrorCode.FILE_NOT_FOUND
            )
        return UploadRead(
            upload_id=upload.upload_uuid,
            original_filename=upload.original_filename,
            byte_size=upload.stored_object.byte_size,
        )

    def delete_upload(self, db: Session, current_user: User, upload_id: str) -> None:
        upload = self.repository.get_upload_by_uuid(db, upload_id)
        if not upload:
            raise ResourceNotFoundException("upload", upload_id)
        if upload.uploader_user_id != current_user.id:
            raise UnauthorizedException(
                CustomerErrorCode.NO_DELETE_ACCESS, {"upload_id": upload_id}
            )
        self.usage.committed_bytes(
            db, require_persisted_id(current_user.id, entity="user"), lock=True
        )
        upload = self.repository.get_upload_by_uuid(db, upload_id, lock=True)
        if upload is None:
            raise ResourceNotFoundException("upload", upload_id)
        upload_pk = require_persisted_id(upload.id, entity="upload")
        if self.repository.upload_reference_count(db, upload_pk) > 0:
            raise ConflictException(
                CustomerErrorCode.VALIDATION_ERROR, {"upload_id": upload.upload_uuid}
            )
        blob = db.get(StoredObject, upload.stored_object_id)
        if blob is None:
            raise RuntimeError("Upload is missing its required stored object")
        size_bytes = blob.byte_size
        storage_key = blob.object_key
        upload_uuid = upload.upload_uuid
        self.repository.delete_upload_by_id(db, require_persisted_id(upload.id, entity="upload"))
        self.usage.record_release(
            db,
            user_id=require_persisted_id(current_user.id, entity="user"),
            category=StorageUsageCategory.UPLOAD,
            bytes_count=size_bytes,
            reason="delete_upload",
            object_type="upload",
            object_id=upload_uuid,
            storage_key=storage_key,
        )
        retire_after_release(db, blob.id)
        return None
