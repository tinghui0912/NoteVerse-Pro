from __future__ import annotations

import uuid

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ImportJob, ImportJobUpload, User
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.schemas import ImportJobProcessingOptions, ImportJobSubmitRequestLike, ImportJobSubmitResult
from app.modules.import_jobs.worker_service import sync_import_job_service
from app.shared.constants import ErrorCode
from app.shared.import_dispatcher import dispatch_import_job
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class ImportJobSubmissionService:
    def __init__(self, storage: FileStorage | None = None) -> None:
        self.storage = storage or file_storage

    async def submit(self, current_user: User, request: ImportJobSubmitRequestLike) -> ImportJobSubmitResult:
        user_id = require_persisted_id(current_user.id, entity="user")
        idempotency_key = self._normalize_key(request.idempotency_key)
        if idempotency_key:
            existing = self._existing_job_uuid(user_id, idempotency_key)
            if existing:
                dispatch_import_job(existing)
                return {"job_id": existing, "count": len(request.file_ids)}

        self._ensure_uploads_exist(user_id, request.file_ids)
        job_uuid = str(uuid.uuid4())
        self._create_pending_job(job_uuid, user_id, request, idempotency_key)
        dispatch_import_job(job_uuid)
        return {"job_id": job_uuid, "count": len(request.file_ids)}

    @staticmethod
    def _normalize_key(value: object) -> str | None:
        return value.strip() or None if isinstance(value, str) else None

    @staticmethod
    def _existing_job_uuid(user_id: int, key: str) -> str | None:
        from app.db.worker_session import get_db_session

        db = get_db_session()
        try:
            job = sync_import_job_service.repository.get_by_idempotency_key(db, user_id, key)
            return job.job_uuid if job else None
        finally:
            db.close()

    def _ensure_uploads_exist(self, user_id: int, file_ids: list[str]) -> None:
        from app.db.worker_session import get_db_session

        db = get_db_session()
        try:
            for file_id in file_ids:
                upload = sync_import_job_service.repository.get_upload_by_sha256(db, file_id)
                if (
                    upload
                    and upload.uploader_user_id == user_id
                    and self.storage.find_score_upload(file_id)
                ):
                    continue
                raise ResourceNotFoundException(
                    resource_type="file",
                    resource_id=file_id,
                    code=ErrorCode.FILE_NOT_FOUND,
                )
        finally:
            db.close()

    @staticmethod
    def _option(options: ImportJobProcessingOptions | None, key: str) -> str | None:
        value = options.get(key) if options else None
        return value if isinstance(value, str) else None

    def _create_pending_job(
        self,
        job_uuid: str,
        user_id: int,
        request: ImportJobSubmitRequestLike,
        idempotency_key: str | None,
    ) -> None:
        from app.db.worker_session import get_db_session

        db = get_db_session()
        try:
            now = utc_now_naive()
            job = ImportJob(
                job_uuid=job_uuid,
                user_id=user_id,
                state=ImportJobState.PENDING,
                progress=0,
                idempotency_key=idempotency_key,
                requested_options=request.options,
                requested_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(job)
            db.flush()
            job_id = require_persisted_id(job.id, entity="import job")

            for file_id in request.file_ids:
                upload = sync_import_job_service.repository.get_upload_by_sha256(db, file_id)
                if not upload or upload.uploader_user_id != user_id:
                    raise ResourceNotFoundException(
                        resource_type="file",
                        resource_id=file_id,
                        code=ErrorCode.FILE_NOT_FOUND,
                    )
                upload_id = require_persisted_id(upload.id, entity="upload")
                db.add(ImportJobUpload(job_id=job_id, upload_id=upload_id))
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

job_submission_service = ImportJobSubmissionService()
