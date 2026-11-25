from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.sql import Select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.async_trace_context import get_async_trace_context
from app.core.config import settings
from app.core.request_correlation import get_request_id
from app.db.models import MailOutbox, MailOutboxStatus
from app.db.models.mail_outbox import MailSourceKind
from app.modules.durable_work.failure import (
    DurableFailure,
    set_failure_facts,
    clear_failure_facts,
)
from app.shared.durable_failure import DurableFailureClass
from app.modules.durable_work.delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
    DeliveryAttemptLease,
)
from app.shared.time import utc_now


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


def queue_mail(
    db: Session,
    *,
    category: str,
    source_kind: MailSourceKind,
    source_id: int,
    dedupe_key: str,
    recipient: str,
    subject: str,
    text_body: str,
    html_body: str | None,
    expires_at: datetime | None = None,
) -> MailOutbox:
    if type(source_id) is not int or source_id <= 0:
        raise ValueError("Mail requires a persisted source identity")
    existing = (
        db.execute(select(MailOutbox).where(MailOutbox.dedupe_key == dedupe_key))
    ).scalar_one_or_none()
    if existing is not None:
        if existing.source_kind != source_kind.value or existing.source_id != source_id:
            raise ValueError("Mail command identity belongs to another source")
        return existing
    traceparent, tracestate = get_async_trace_context()
    outbox = MailOutbox(
        source_kind=source_kind.value,
        source_id=source_id,
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
    db.flush()
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
            MailOutboxStatus.CANCELLED,
        }:
            return None
        now = utc_now()
        if outbox.expires_at is not None and outbox.expires_at <= now:
            self._finish(outbox, MailOutboxStatus.EXPIRED, now=now, error=outbox.failure_detail)
            set_failure_facts(
                outbox,
                DurableFailure("mail_expired", "delivery", DurableFailureClass.PERMANENT, False),
                detail=outbox.failure_detail,
            )
            return None
        lifecycle = _delivery_lifecycle()
        admission = lifecycle.claim_admission(outbox, now=now)
        if admission in {ClaimAdmission.INACTIVE, ClaimAdmission.NOT_DUE}:
            return None
        if admission is ClaimAdmission.EXHAUSTED:
            self._finish(
                outbox, MailOutboxStatus.PERMANENT_FAILURE, now=now, error=outbox.failure_detail
            )
            set_failure_facts(
                outbox,
                DurableFailure(
                    "mail_attempts_exhausted", "delivery", DurableFailureClass.TRANSIENT, False
                ),
                detail=outbox.failure_detail,
            )
            return None
        if outbox.source_kind is None or outbox.source_id is None:
            self._finish(outbox, MailOutboxStatus.PERMANENT_FAILURE, now=now, error=None)
            set_failure_facts(
                outbox,
                DurableFailure(
                    "mail_source_missing", "admission", DurableFailureClass.PERMANENT, False
                ),
            )
            return None
        if not outbox.text_body:
            self._finish(
                outbox,
                MailOutboxStatus.PERMANENT_FAILURE,
                now=now,
                error="Mail outbox body is unavailable",
            )
            set_failure_facts(
                outbox,
                DurableFailure(
                    "mail_body_unavailable", "delivery", DurableFailureClass.PERMANENT, False
                ),
                detail=outbox.failure_detail,
            )
            return None

        lease = lifecycle.claim(outbox, token=str(uuid4()), now=now)
        if lease is None:
            return None
        clear_failure_facts(outbox)
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

    def delivery_permitted(
        self, db: Session, outbox_uuid: str, *, lease: DeliveryAttemptLease
    ) -> bool:
        """Final DB admission before provider IO; never holds locks across the network."""
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().attempt_matches(outbox, lease):
            return False
        if outbox.expires_at is not None and outbox.expires_at <= utc_now():
            self._finish(outbox, MailOutboxStatus.EXPIRED, now=utc_now(), error=None)
            set_failure_facts(
                outbox,
                DurableFailure("mail_expired", "delivery", DurableFailureClass.PERMANENT, False),
            )
            return False
        return True

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
            outbox, lease=lease, now=utc_now()
        ):
            return False
        outbox.text_body = outbox.html_body = None
        outbox.provider_message_id = provider_message_id
        clear_failure_facts(outbox)
        return True

    def transient_failure(
        self, db: Session, outbox_uuid: str, error: str, *, lease: DeliveryAttemptLease
    ) -> bool:
        outbox = self._get(db, outbox_uuid)
        lifecycle, now = _delivery_lifecycle(), utc_now()
        if outbox is None or not lifecycle.attempt_matches(outbox, lease):
            return False
        if outbox.attempt_count >= lifecycle.policy.max_attempts:
            lifecycle.finish_attempt(
                outbox, lease=lease, status=MailOutboxStatus.PERMANENT_FAILURE, error=error, now=now
            )
            outbox.text_body = outbox.html_body = None
        else:
            lifecycle.fail_attempt(outbox, lease=lease, error=error, now=now)
        self._record_failure(
            outbox, code="mail_provider_transient", classification=DurableFailureClass.TRANSIENT
        )
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
            now=utc_now(),
        ):
            return False
        outbox.text_body = outbox.html_body = None
        set_failure_facts(
            outbox,
            DurableFailure(
                "mail_provider_permanent", "delivery", DurableFailureClass.PERMANENT, False
            ),
            detail=outbox.failure_detail,
        )
        return True

    @staticmethod
    def _record_failure(
        outbox: MailOutbox,
        *,
        code: str,
        classification: DurableFailureClass,
        stage: str = "delivery",
    ) -> None:
        retryable = outbox.attempt_count < settings.MAIL_OUTBOX_MAX_ATTEMPTS
        set_failure_facts(
            outbox,
            DurableFailure(
                code if retryable else "mail_attempts_exhausted", stage, classification, retryable
            ),
            detail=outbox.failure_detail,
        )

    def execution_failure(
        self, db: Session, outbox_uuid: str, error: str, *, lease: DeliveryAttemptLease
    ) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().fail_attempt(
            outbox, lease=lease, error=error, now=utc_now()
        ):
            return False
        self._record_failure(
            outbox, code="mail_execution_failed", classification=DurableFailureClass.SYSTEM_ERROR
        )
        return True

    def rearm_for_operator(self, db: Session, operation_id: str) -> str:
        from app.core.exceptions import ResourceNotFoundException, ValidationException

        outbox = self._get(db, operation_id)
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        now = utc_now()
        if (
            outbox.status not in (MailOutboxStatus.PENDING, MailOutboxStatus.FAILED)
            or outbox.failure_code is None
            or (outbox.expires_at is not None and outbox.expires_at <= now)
        ):
            raise ValidationException(field="status", details={"status": outbox.status.value})
        if not outbox.text_body:
            raise ValidationException(field="body", details={"reason": "mail_body_unavailable"})
        previous = outbox.status.value
        _delivery_lifecycle().rearm(outbox, now=now)
        clear_failure_facts(outbox)
        return previous

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        now = utc_now()
        if outbox is None or (outbox.expires_at is not None and outbox.expires_at <= now):
            return False
        if not _delivery_lifecycle().dispatch(outbox, now=now):
            return False
        clear_failure_facts(outbox)
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().release_dispatch(
            outbox, error=error, now=utc_now()
        ):
            return
        self._record_failure(
            outbox,
            code="mail_dispatch_failed",
            classification=DurableFailureClass.TRANSIENT,
            stage="dispatch",
        )

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now()
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
                self._record_failure(
                    outbox,
                    code="mail_delivery_lease_expired",
                    classification=DurableFailureClass.TRANSIENT,
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
            self._finish(outbox, MailOutboxStatus.EXPIRED, now=now, error=outbox.failure_detail)
            set_failure_facts(
                outbox,
                DurableFailure("mail_expired", "delivery", DurableFailureClass.PERMANENT, False),
                detail=outbox.failure_detail,
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
        cutoff = utc_now() - timedelta(days=settings.MAIL_OUTBOX_RETENTION_DAYS)
        result = db.execute(
            delete(MailOutbox).where(
                col(MailOutbox.status).in_(
                    [
                        MailOutboxStatus.SENT,
                        MailOutboxStatus.PERMANENT_FAILURE,
                        MailOutboxStatus.EXPIRED,
                        MailOutboxStatus.CANCELLED,
                    ]
                ),
                col(MailOutbox.completed_at) < cutoff,
            )
        )
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


def cancel_source_mail(
    db: Session, source_kind: MailSourceKind, source_ids: Select[tuple[int]]
) -> None:
    """Source owner invalidates delivery and erases payload in its own transaction.

    SENT evidence remains SENT; provider handoff cannot be recalled. Cancelling an
    active attempt clears its lease, so late provider results cannot revive it.
    Identities and attempts remain auditable; no recipient-based ownership inference.
    """
    table = MailOutbox.__table__
    condition = (table.c.source_kind == source_kind.value) & table.c.source_id.in_(source_ids)
    db.execute(
        update(table)
        .where(
            condition,
            table.c.status.in_(
                [
                    MailOutboxStatus.PENDING,
                    MailOutboxStatus.DISPATCHED,
                    MailOutboxStatus.PROCESSING,
                    MailOutboxStatus.FAILED,
                ]
            ),
        )
        .values(
            status=MailOutboxStatus.CANCELLED,
            attempt_token=None,
            completed_at=utc_now(),
            updated_at=utc_now(),
            failure_code=None,
            failure_stage=None,
            failure_classification=None,
            failure_retryable=None,
            failure_detail=None,
        )
    )
    db.execute(
        update(table)
        .where(condition)
        .values(
            recipient="",
            subject="",
            text_body=None,
            html_body=None,
            dedupe_key="erased:" + table.c.outbox_uuid,
            provider_message_id=None,
            failure_detail=None,
            updated_at=utc_now(),
        )
    )
