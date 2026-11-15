from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models import (
    ImportJob,
    ImportDispatch,
    ImportJobState,
    MailOutbox,
    MailOutboxStatus,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    RenderOutbox,
    RenderOutboxStatus,
)
from app.modules.async_operations.diagnostics import clear_async_diagnostic
from app.modules.ops.operation_projection import (
    import_operation_status,
    mail_operation_status,
    read_import_operation,
    read_mail_operation,
    read_playback_operation,
    read_render_operation,
    read_score_deletion_operation,
)
from app.modules.ops.schemas import AsyncOperationKind, AsyncOperationRead
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


RETRYABLE_OPERATION_KINDS = (
    AsyncOperationKind.IMPORT,
    AsyncOperationKind.RENDER,
    AsyncOperationKind.PLAYBACK,
    AsyncOperationKind.MAIL,
    AsyncOperationKind.SCORE_DELETION,
)


@dataclass(frozen=True)
class RetryOperationResult:
    operation: AsyncOperationRead
    previous_state: str


class OpsAsyncOperationCommandService:
    def retry_operation(
        self,
        db: Session,
        *,
        kind: AsyncOperationKind,
        operation_id: str,
    ) -> RetryOperationResult:
        if kind == AsyncOperationKind.IMPORT:
            return self._retry_import(db, operation_id)
        if kind == AsyncOperationKind.RENDER:
            return self._retry_render(db, operation_id)
        if kind == AsyncOperationKind.PLAYBACK:
            return self._retry_playback(db, operation_id)
        if kind == AsyncOperationKind.MAIL:
            return self._retry_mail(db, operation_id)
        if kind == AsyncOperationKind.SCORE_DELETION:
            return self._retry_score_deletion(db, operation_id)
        raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="kind")

    def _retry_import(self, db: Session, operation_id: str) -> RetryOperationResult:
        dispatch = (
            db.execute(
                select(ImportDispatch)
                .where(ImportDispatch.dispatch_uuid == operation_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if dispatch is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        job = (
            db.execute(
                select(ImportJob)
                .where(ImportJob.id == dispatch.job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if job is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = f"{job.state.value}/{dispatch.status.value}"
        if job.state in {
            ImportJobState.RUNNING,
            ImportJobState.PENDING_REVIEW,
            ImportJobState.CONFIRMED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": import_operation_status(job, dispatch).value},
            )
        now = utc_now_naive()
        from app.modules.import_jobs.dispatch_service import import_dispatch_service

        import_dispatch_service.reset_execution(db, job, now)
        import_dispatch_service.lifecycle().rearm(dispatch, now=now)
        clear_async_diagnostic(dispatch)
        db.commit()
        db.refresh(job)
        db.refresh(dispatch)
        return RetryOperationResult(
            operation=read_import_operation(job, dispatch), previous_state=previous_state
        )

    def _retry_render(self, db: Session, operation_id: str) -> RetryOperationResult:
        outbox = (
            db.execute(
                select(RenderOutbox)
                .where(RenderOutbox.outbox_uuid == operation_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = outbox.status.value
        if outbox.status in {
            RenderOutboxStatus.PROCESSING,
            RenderOutboxStatus.DISPATCHED,
            RenderOutboxStatus.COMPLETED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": read_render_operation(outbox).status.value},
            )
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        db.commit()
        db.refresh(outbox)
        return RetryOperationResult(
            operation=read_render_operation(outbox), previous_state=previous_state
        )

    def _retry_playback(self, db: Session, operation_id: str) -> RetryOperationResult:
        outbox = (
            db.execute(
                select(PlaybackOutbox)
                .where(PlaybackOutbox.outbox_uuid == operation_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = outbox.status.value
        if outbox.status in {
            PlaybackOutboxStatus.PROCESSING,
            PlaybackOutboxStatus.DISPATCHED,
            PlaybackOutboxStatus.COMPLETED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": read_playback_operation(outbox).status.value},
            )
        now = utc_now_naive()
        outbox.status = PlaybackOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        db.commit()
        db.refresh(outbox)
        return RetryOperationResult(
            operation=read_playback_operation(outbox), previous_state=previous_state
        )

    def _retry_mail(self, db: Session, operation_id: str) -> RetryOperationResult:
        outbox = (
            db.execute(
                select(MailOutbox).where(MailOutbox.outbox_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = outbox.status.value
        if outbox.status in {
            MailOutboxStatus.PROCESSING,
            MailOutboxStatus.DISPATCHED,
            MailOutboxStatus.SENT,
            MailOutboxStatus.PERMANENT_FAILURE,
            MailOutboxStatus.EXPIRED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": mail_operation_status(outbox).value},
            )
        if not outbox.text_body:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="body",
                details={"reason": "mail_body_unavailable"},
            )
        now = utc_now_naive()
        outbox.status = MailOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        db.commit()
        db.refresh(outbox)
        return RetryOperationResult(
            operation=read_mail_operation(outbox), previous_state=previous_state
        )

    def _retry_score_deletion(self, db: Session, operation_id: str) -> RetryOperationResult:
        from app.modules.scores.deletion_delivery import score_deletion_delivery

        operation, previous = score_deletion_delivery.rearm(db, operation_id)
        db.commit()
        db.refresh(operation)
        return RetryOperationResult(
            operation=read_score_deletion_operation(operation), previous_state=previous
        )


ops_async_operation_command_service = OpsAsyncOperationCommandService()
