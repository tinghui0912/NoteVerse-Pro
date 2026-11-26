"""Durable admission of an Import job, dispatch and ordered upload links."""

from app.modules.storage_governance.usage.service import StorageUsageService

import uuid
import hashlib
import json

from sqlalchemy.orm import Session

from app.core.async_trace_context import get_async_trace_context
from app.core.exceptions import ResourceNotFoundException, ConflictException
from app.core.request_correlation import get_request_id
from app.db.model_utils import require_persisted_id
from app.db.models import ImportDispatch, ImportJob, ImportJobUpload, User
from app.modules.import_jobs.domain import ImportJobState
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.import_jobs.repository import ImportJobRepository

from app.modules.import_jobs.requested_options import encode_requested_options
from app.modules.import_jobs.schemas import (
    ImportJobSubmitRequestLike,
    ImportJobSubmitResult,
)
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from app.modules.import_jobs.lifecycle import queue_import


class ImportJobSubmissionService:
    def __init__(
        self, repository: ImportJobRepository | None = None, *, usage: StorageUsageService
    ) -> None:
        self.usage = usage
        self.repository = repository or ImportJobRepository()

    def submit(
        self, db: Session, current_user: User, request: ImportJobSubmitRequestLike
    ) -> ImportJobSubmitResult:
        user_id = require_persisted_id(current_user.id, entity="user")
        lock_active_resource_user(db, user_id)
        key = self._normalize_key(request.idempotency_key)
        fingerprint = (
            hashlib.sha256(
                json.dumps(
                    [request.upload_ids, encode_requested_options(request.options)],
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode()
            ).hexdigest()
            if key
            else None
        )
        self.usage.committed_bytes(db, user_id, lock=True)
        if key:
            existing = self.repository.get_by_idempotency_key(db, user_id, key)
            if existing:
                if existing.submission_fingerprint != fingerprint:
                    raise ConflictException(
                        CustomerErrorCode.VALIDATION_ERROR, {"reason": "import_submission_conflict"}
                    )
                return self._result(existing.job_uuid, request)
        uploads = {
            row["upload_uuid"]: row
            for row in self.repository.submission_uploads(db, request.upload_ids)
        }
        for upload_id in request.upload_ids:
            upload = uploads.get(upload_id)
            if upload is None or upload["uploader_user_id"] != user_id:
                raise ResourceNotFoundException(
                    "upload", upload_id, CustomerErrorCode.FILE_NOT_FOUND
                )
        now = utc_now()
        job_uuid = str(uuid.uuid4())
        traceparent, tracestate = get_async_trace_context()
        job = ImportJob(
            job_uuid=job_uuid,
            user_id=user_id,
            idempotency_key=key,
            submission_fingerprint=fingerprint,
            requested_options=encode_requested_options(request.options),
        )
        queue_import(job, now=now)
        db.add(job)
        db.flush()
        job_id = require_persisted_id(job.id, entity="import job")
        db.add(
            ImportDispatch(
                job_id=job_id,
                originating_request_id=get_request_id(),
                traceparent=traceparent,
                tracestate=tracestate,
            )
        )
        for index, upload_id in enumerate(request.upload_ids, 1):
            db.add(
                ImportJobUpload(
                    job_id=job_id,
                    upload_id=uploads[upload_id]["id"],
                    page_number=index,
                    sort_order=index,
                )
            )
        db.flush()
        return self._result(job_uuid, request)

    @staticmethod
    def _result(job_uuid: str, request: ImportJobSubmitRequestLike) -> ImportJobSubmitResult:
        return {
            "job_id": job_uuid,
            "count": len(request.upload_ids),
            "state": ImportJobState.QUEUED,
        }

    @staticmethod
    def _normalize_key(value: object) -> str | None:
        return value.strip() or None if isinstance(value, str) else None
