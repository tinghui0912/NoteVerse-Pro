from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.async_trace_context import get_async_trace_context
from app.core.config import settings
from app.core.request_correlation import get_request_id
from app.db.models import MailOutbox, MailOutboxStatus
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
    clear_async_diagnostic,
)
from app.modules.async_operations.durable_delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
    DeliveryAttemptLease,
)
from app.utils.timezone import utc_now_naive


def _delivery_lifecycle() -> DurableDeliveryLifecycle[MailOutboxStatus]:
    return DurableDeliveryLifecycle(
        statuses=DeliveryStatuses(
            pending=MailOutboxStatus.PENDING,
            dispatched=MailOutboxStatus.DISPATCHED,
            processing=MailOutboxStatus.PROCESSING,
            failed=MailOutboxStatus.FAILED,
            succeeded=MailOutboxStatus.SENT,
        ),
        policy=DeliveryLifecyclePolicy(
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            retry_base_seconds=settings.MAIL_OUTBOX_RETRY_BASE_SECONDS,
            dispatch_timeout_seconds=settings.MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
            processing_timeout_seconds=settings.MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


@dataclass(frozen=True)
class MailOutboxPayload:
    outbox_uuid: str
    recipient: str
    subject: str
    text_body: str
    html_body: str | None
    category: str
    lease: DeliveryAttemptLease
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
            select(MailOutbox)
            .where(MailOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
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
            self._finish(outbox, MailOutboxStatus.EXPIRED, now=now, error=outbox.last_error)
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
        lifecycle = _delivery_lifecycle()
        admission = lifecycle.claim_admission(outbox, now=now)
        if admission in {ClaimAdmission.INACTIVE, ClaimAdmission.NOT_DUE}:
            return None
        if admission is ClaimAdmission.EXHAUSTED:
            self._finish(
                outbox, MailOutboxStatus.PERMANENT_FAILURE, now=now, error=outbox.last_error
            )
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
            self._finish(
                outbox,
                MailOutboxStatus.PERMANENT_FAILURE,
                now=now,
                error="Mail outbox body is unavailable",
            )
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

        lease = lifecycle.claim(outbox, token=str(uuid4()), now=now)
        if lease is None:
            return None
        clear_async_diagnostic(outbox)
        return MailOutboxPayload(
            outbox_uuid=outbox.outbox_uuid,
            recipient=outbox.recipient,
            subject=outbox.subject,
            text_body=outbox.text_body,
            html_body=outbox.html_body,
            category=outbox.category,
            lease=lease,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            originating_request_id=outbox.originating_request_id,
            traceparent=outbox.traceparent,
            tracestate=outbox.tracestate,
        )

    def sent(
        self,
        db: Session,
        outbox_uuid: str,
        provider_message_id: str | None,
        *,
        lease: DeliveryAttemptLease,
    ) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().complete_attempt(
            outbox, lease=lease, now=utc_now_naive()
        ):
            return False
        outbox.text_body = outbox.html_body = None
        outbox.provider_message_id = provider_message_id
        clear_async_diagnostic(outbox)
        return True

    def transient_failure(
        self, db: Session, outbox_uuid: str, error: str, *, lease: DeliveryAttemptLease
    ) -> bool:
        outbox = self._get(db, outbox_uuid)
        lifecycle, now = _delivery_lifecycle(), utc_now_naive()
        if outbox is None or not lifecycle.attempt_matches(outbox, lease):
            return False
        if outbox.attempt_count >= lifecycle.policy.max_attempts:
            return self.permanent_failure(db, outbox_uuid, error, lease=lease)
        lifecycle.fail_attempt(outbox, lease=lease, error=error, now=now)
        self._failure_diagnostic(outbox)
        return True

    def permanent_failure(
        self, db: Session, outbox_uuid: str, error: str, *, lease: DeliveryAttemptLease
    ) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().finish_attempt(
            outbox,
            lease=lease,
            status=MailOutboxStatus.PERMANENT_FAILURE,
            error=error,
            now=utc_now_naive(),
        ):
            return False
        outbox.text_body = outbox.html_body = None
        self._failure_diagnostic(outbox)
        return True

    @staticmethod
    def _failure_diagnostic(outbox: MailOutbox) -> None:
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.MAIL,
            status=AsyncOperationStatusValue.PERMANENT_FAILED
            if outbox.status == MailOutboxStatus.PERMANENT_FAILURE
            else AsyncOperationStatusValue.RETRYING,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
        )

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        now = utc_now_naive()
        if outbox is None or (outbox.expires_at is not None and outbox.expires_at <= now):
            return False
        if not _delivery_lifecycle().dispatch(outbox, now=now):
            return False
        clear_async_diagnostic(outbox)
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().release_dispatch(
            outbox, error=error, now=utc_now_naive()
        ):
            return
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.MAIL,
            status=AsyncOperationStatusValue.QUEUED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
        )

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        active = (
            db.execute(
                select(MailOutbox)
                .where(
                    or_(
                        MailOutbox.status == MailOutboxStatus.DISPATCHED,
                        MailOutbox.status == MailOutboxStatus.PROCESSING,
                    )
                )
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )
            .scalars()
            .all()
        )
        for outbox in active:
            if _delivery_lifecycle().recover_lease(
                outbox, error="Mail delivery lease expired", now=now
            ):
                apply_async_diagnostic(
                    outbox,
                    kind=AsyncOperationKindValue.MAIL,
                    status=AsyncOperationStatusValue.FAILED,
                    raw_status=outbox.status.value,
                    last_error=outbox.last_error,
                    attempts=outbox.attempt_count,
                    max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
                )

        expirable = (
            db.execute(
                select(MailOutbox)
                .where(
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
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )
            .scalars()
            .all()
        )
        for outbox in expirable:
            self._finish(outbox, MailOutboxStatus.EXPIRED, now=now, error=outbox.last_error)
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
                    col(MailOutbox.status).in_([MailOutboxStatus.PENDING, MailOutboxStatus.FAILED]),
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
        outbox: MailOutbox, status: MailOutboxStatus, *, now: datetime, error: str | None
    ) -> None:
        _delivery_lifecycle().finish(outbox, status=status, error=error, now=now)
        outbox.text_body = None
        outbox.html_body = None

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> MailOutbox | None:
        return db.execute(
            select(MailOutbox)
            .where(MailOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()


mail_outbox_service = MailOutboxService()
