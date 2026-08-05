from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.async_trace_context import get_async_trace_context
from app.core.config import settings
from app.core.logger import get_request_id
from app.db.models import MailOutbox, MailOutboxStatus
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
    clear_async_diagnostic,
)
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class MailOutboxPayload:
    outbox_uuid: str
    recipient: str
    subject: str
    text_body: str
    html_body: str | None
    category: str
    attempt: int
    max_attempts: int
    originating_request_id: str | None = None
    traceparent: str | None = None
    tracestate: str | None = None


async def queue_mail(
    db: AsyncSession,
    *,
    category: str,
    dedupe_key: str,
    recipient: str,
    subject: str,
    text_body: str,
    html_body: str | None,
    expires_at: datetime | None = None,
) -> MailOutbox:
    existing = (
        await db.execute(select(MailOutbox).where(MailOutbox.dedupe_key == dedupe_key))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    traceparent, tracestate = get_async_trace_context()
    outbox = MailOutbox(
        category=category,
        dedupe_key=dedupe_key,
        originating_request_id=get_request_id(),
        traceparent=traceparent,
        tracestate=tracestate,
        recipient=recipient.strip().lower(),
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        expires_at=expires_at,
    )
    db.add(outbox)
    await db.flush()
    return outbox


class MailOutboxService:
    def claim(self, db: Session, outbox_uuid: str) -> MailOutboxPayload | None:
        outbox = db.execute(
            select(MailOutbox).where(MailOutbox.outbox_uuid == outbox_uuid).with_for_update()
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            MailOutboxStatus.PROCESSING,
            MailOutboxStatus.SENT,
            MailOutboxStatus.PERMANENT_FAILURE,
            MailOutboxStatus.EXPIRED,
        }:
            return None
        now = utc_now_naive()
        if outbox.expires_at is not None and outbox.expires_at <= now:
            self._finish(outbox, MailOutboxStatus.EXPIRED, now=now)
            apply_async_diagnostic(
                outbox,
                kind=AsyncOperationKindValue.MAIL,
                status=AsyncOperationStatusValue.EXPIRED,
                raw_status=outbox.status.value,
                last_error=outbox.last_error,
                attempts=outbox.attempt_count,
                max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            )
            return None
        if outbox.status == MailOutboxStatus.FAILED and outbox.next_attempt_at > now:
            return None
        if outbox.attempt_count >= settings.MAIL_OUTBOX_MAX_ATTEMPTS:
            self._finish(outbox, MailOutboxStatus.PERMANENT_FAILURE, now=now)
            apply_async_diagnostic(
                outbox,
                kind=AsyncOperationKindValue.MAIL,
                status=AsyncOperationStatusValue.EXHAUSTED,
                raw_status=outbox.status.value,
                last_error=outbox.last_error,
                attempts=outbox.attempt_count,
                max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            )
            return None
        if not outbox.text_body:
            self._finish(outbox, MailOutboxStatus.PERMANENT_FAILURE, now=now)
            outbox.last_error = "Mail outbox body is unavailable"
            apply_async_diagnostic(
                outbox,
                kind=AsyncOperationKindValue.MAIL,
                status=AsyncOperationStatusValue.PERMANENT_FAILED,
                raw_status=outbox.status.value,
                last_error=outbox.last_error,
                attempts=outbox.attempt_count,
                max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            )
            return None

        outbox.status = MailOutboxStatus.PROCESSING
        outbox.attempt_count += 1
        outbox.started_at = now
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        return MailOutboxPayload(
            outbox_uuid=outbox.outbox_uuid,
            recipient=outbox.recipient,
            subject=outbox.subject,
            text_body=outbox.text_body,
            html_body=outbox.html_body,
            category=outbox.category,
            attempt=outbox.attempt_count,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            originating_request_id=outbox.originating_request_id,
            traceparent=outbox.traceparent,
            tracestate=outbox.tracestate,
        )

    def sent(self, db: Session, outbox_uuid: str, provider_message_id: str | None) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        self._finish(outbox, MailOutboxStatus.SENT)
        outbox.provider_message_id = provider_message_id
        outbox.last_error = None
        clear_async_diagnostic(outbox)

    def transient_failure(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        if outbox.attempt_count >= settings.MAIL_OUTBOX_MAX_ATTEMPTS:
            self._finish(outbox, MailOutboxStatus.PERMANENT_FAILURE, now=now)
        else:
            delay = settings.MAIL_OUTBOX_RETRY_BASE_SECONDS * (
                2 ** max(0, outbox.attempt_count - 1)
            )
            outbox.status = MailOutboxStatus.FAILED
            outbox.next_attempt_at = now + timedelta(seconds=delay)
            outbox.updated_at = now
        outbox.last_error = error[:4000]
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.MAIL,
            status=(
                AsyncOperationStatusValue.PERMANENT_FAILED
                if outbox.status == MailOutboxStatus.PERMANENT_FAILURE
                else AsyncOperationStatusValue.RETRYING
            ),
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
        )

    def permanent_failure(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        self._finish(outbox, MailOutboxStatus.PERMANENT_FAILURE)
        outbox.last_error = error[:4000]
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.MAIL,
            status=AsyncOperationStatusValue.PERMANENT_FAILED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
        )

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = MailOutboxStatus.DISPATCHED
        outbox.dispatched_at = now
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status != MailOutboxStatus.DISPATCHED:
            return
        outbox.status = MailOutboxStatus.PENDING
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.MAIL,
            status=AsyncOperationStatusValue.QUEUED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
        )
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        dispatch_cutoff = now - timedelta(seconds=settings.MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS)
        processing_cutoff = now - timedelta(seconds=settings.MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS)
        active = (
            db.execute(
                select(MailOutbox).where(
                    or_(
                        MailOutbox.status == MailOutboxStatus.DISPATCHED,
                        MailOutbox.status == MailOutboxStatus.PROCESSING,
                    )
                )
            )
            .scalars()
            .all()
        )
        for outbox in active:
            stale_dispatch = (
                outbox.status == MailOutboxStatus.DISPATCHED
                and outbox.dispatched_at is not None
                and outbox.dispatched_at <= dispatch_cutoff
            )
            stale_processing = (
                outbox.status == MailOutboxStatus.PROCESSING
                and outbox.started_at is not None
                and outbox.started_at <= processing_cutoff
            )
            if stale_dispatch or stale_processing:
                outbox.status = MailOutboxStatus.FAILED
                outbox.next_attempt_at = now
                outbox.last_error = "Mail delivery lease expired"
                apply_async_diagnostic(
                    outbox,
                    kind=AsyncOperationKindValue.MAIL,
                    status=AsyncOperationStatusValue.FAILED,
                    raw_status=outbox.status.value,
                    last_error=outbox.last_error,
                    attempts=outbox.attempt_count,
                    max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
                )
                outbox.updated_at = now

        expirable = (
            db.execute(
                select(MailOutbox).where(
                    col(MailOutbox.expires_at).is_not(None),
                    col(MailOutbox.expires_at) <= now,
                    col(MailOutbox.status).in_(
                        [
                            MailOutboxStatus.PENDING,
                            MailOutboxStatus.FAILED,
                            MailOutboxStatus.DISPATCHED,
                        ]
                    ),
                )
            )
            .scalars()
            .all()
        )
        for outbox in expirable:
            self._finish(outbox, MailOutboxStatus.EXPIRED, now=now)
            apply_async_diagnostic(
                outbox,
                kind=AsyncOperationKindValue.MAIL,
                status=AsyncOperationStatusValue.EXPIRED,
                raw_status=outbox.status.value,
                last_error=outbox.last_error,
                attempts=outbox.attempt_count,
                max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            )

        due = (
            db.execute(
                select(MailOutbox.outbox_uuid)
                .where(
                    col(MailOutbox.status).in_(
                        [MailOutboxStatus.PENDING, MailOutboxStatus.FAILED]
                    ),
                    MailOutbox.next_attempt_at <= now,
                    MailOutbox.attempt_count < settings.MAIL_OUTBOX_MAX_ATTEMPTS,
                    or_(col(MailOutbox.expires_at).is_(None), col(MailOutbox.expires_at) > now),
                )
                .order_by(MailOutbox.created_at)
                .limit(settings.MAIL_OUTBOX_DISPATCH_BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .all()
        )
        db.commit()
        return list(due)

    def cleanup(self, db: Session) -> int:
        cutoff = utc_now_naive() - timedelta(days=settings.MAIL_OUTBOX_RETENTION_DAYS)
        result = db.execute(
            delete(MailOutbox).where(
                col(MailOutbox.status).in_(
                    [
                        MailOutboxStatus.SENT,
                        MailOutboxStatus.PERMANENT_FAILURE,
                        MailOutboxStatus.EXPIRED,
                    ]
                ),
                col(MailOutbox.completed_at) < cutoff,
            )
        )
        db.commit()
        return int(result.rowcount or 0)

    @staticmethod
    def _finish(
        outbox: MailOutbox,
        status: MailOutboxStatus,
        *,
        now: datetime | None = None,
    ) -> None:
        completed_at = now or utc_now_naive()
        outbox.status = status
        outbox.completed_at = completed_at
        outbox.text_body = None
        outbox.html_body = None
        outbox.updated_at = completed_at

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> MailOutbox | None:
        return db.execute(
            select(MailOutbox).where(MailOutbox.outbox_uuid == outbox_uuid)
        ).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: MailOutbox) -> bool:
        now = utc_now_naive()
        return (
            outbox.status in {MailOutboxStatus.PENDING, MailOutboxStatus.FAILED}
            and outbox.attempt_count < settings.MAIL_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= now
            and (outbox.expires_at is None or outbox.expires_at > now)
        )


mail_outbox_service = MailOutboxService()
