from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.config import settings
from app.db.models import (
    ImportArtifact,
    ImportJob,
    RenderOutbox,
    RenderOutboxStatus,
    RenderTargetType,
    Score,
    ScoreDeletionStatus,
    ScoreRevision,
)
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
    clear_async_diagnostic,
)
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.db.models.import_job import ImportJobState
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class RenderOutboxPayload:
    outbox_uuid: str
    target_type: RenderTargetType
    render_profile: str
    source_fingerprint: str
    score_uuid: str | None = None
    revision_uuid: str | None = None
    user_id: int | None = None
    job_uuid: str | None = None


async def create_revision_render_outbox(
    db: AsyncSession,
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    render_profile: str = "default",
) -> RenderOutbox:
    existing = (
        await db.execute(
            select(RenderOutbox).where(
                RenderOutbox.revision_id == revision_id,
                RenderOutbox.render_profile == render_profile,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    outbox = RenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        target_type=RenderTargetType.SCORE_REVISION,
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
        status=RenderOutboxStatus.PENDING,
    )
    db.add(outbox)
    await db.flush()
    return outbox


async def create_review_thumbnail_render_outbox(
    db: AsyncSession,
    *,
    import_job_id: int,
    source_fingerprint: str,
    render_profile: str = "review-thumbnail",
) -> RenderOutbox:
    existing = (
        await db.execute(
            select(RenderOutbox).where(
                RenderOutbox.import_job_id == import_job_id,
                RenderOutbox.render_profile == render_profile,
                RenderOutbox.source_fingerprint == source_fingerprint,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    outbox = _new_review_thumbnail_outbox(
        import_job_id=import_job_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
    )
    db.add(outbox)
    await db.flush()
    return outbox


def create_review_thumbnail_render_outbox_sync(
    db: Session,
    *,
    import_job_id: int,
    source_fingerprint: str,
    render_profile: str = "review-thumbnail",
) -> RenderOutbox:
    existing = db.execute(
        select(RenderOutbox).where(
            RenderOutbox.import_job_id == import_job_id,
            RenderOutbox.render_profile == render_profile,
            RenderOutbox.source_fingerprint == source_fingerprint,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    outbox = _new_review_thumbnail_outbox(
        import_job_id=import_job_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
    )
    db.add(outbox)
    db.flush()
    return outbox


def _new_review_thumbnail_outbox(
    *, import_job_id: int, source_fingerprint: str, render_profile: str
) -> RenderOutbox:
    return RenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        target_type=RenderTargetType.REVIEW_THUMBNAIL,
        import_job_id=import_job_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
        status=RenderOutboxStatus.PENDING,
    )


class RenderOutboxService:
    def claim(self, db: Session, outbox_uuid: str) -> RenderOutboxPayload | None:
        outbox = db.execute(
            select(RenderOutbox)
            .where(RenderOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            RenderOutboxStatus.PROCESSING,
            RenderOutboxStatus.COMPLETED,
        }:
            return None
        if outbox.status == RenderOutboxStatus.FAILED and outbox.next_attempt_at > utc_now_naive():
            return None
        if outbox.attempt_count >= settings.RENDER_OUTBOX_MAX_ATTEMPTS:
            return None

        payload = self._build_payload(db, outbox)
        if payload is None:
            return None
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.PROCESSING
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return payload

    def _build_payload(self, db: Session, outbox: RenderOutbox) -> RenderOutboxPayload | None:
        if outbox.target_type == RenderTargetType.SCORE_REVISION:
            score = db.get(Score, outbox.score_id)
            revision = db.get(ScoreRevision, outbox.revision_id)
            if (
                score is not None
                and score.deletion_status == ScoreDeletionStatus.ACTIVE
                and revision is not None
                and outbox.requested_by_user_id is not None
            ):
                return RenderOutboxPayload(
                    outbox_uuid=outbox.outbox_uuid,
                    target_type=outbox.target_type,
                    score_uuid=score.score_uuid,
                    revision_uuid=revision.revision_uuid,
                    user_id=outbox.requested_by_user_id,
                    render_profile=outbox.render_profile,
                    source_fingerprint=outbox.source_fingerprint,
                )
        elif outbox.target_type == RenderTargetType.REVIEW_THUMBNAIL:
            job = db.get(ImportJob, outbox.import_job_id)
            review_source = db.execute(
                select(ImportArtifact).where(
                    ImportArtifact.job_id == outbox.import_job_id,
                    ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
                )
            ).scalar_one_or_none()
            if job is not None and review_source is not None:
                if job.state != ImportJobState.PENDING_REVIEW:
                    self.complete(db, outbox.outbox_uuid)
                    return None
                if review_source.sha256 != outbox.source_fingerprint:
                    self.complete(db, outbox.outbox_uuid)
                    return None
                return RenderOutboxPayload(
                    outbox_uuid=outbox.outbox_uuid,
                    target_type=outbox.target_type,
                    job_uuid=job.job_uuid,
                    render_profile=outbox.render_profile,
                    source_fingerprint=outbox.source_fingerprint,
                )

        outbox.status = RenderOutboxStatus.FAILED
        outbox.attempt_count = settings.RENDER_OUTBOX_MAX_ATTEMPTS
        outbox.last_error = "Render outbox references unavailable resources"
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.RENDER,
            status=AsyncOperationStatusValue.EXHAUSTED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        )
        outbox.updated_at = utc_now_naive()
        return None

    def complete(self, db: Session, outbox_uuid: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.COMPLETED
        outbox.completed_at = now
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now

    def fail(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        delay = settings.RENDER_OUTBOX_RETRY_BASE_SECONDS * (2 ** max(0, outbox.attempt_count - 1))
        outbox.status = RenderOutboxStatus.FAILED
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.RENDER,
            status=(
                AsyncOperationStatusValue.EXHAUSTED
                if outbox.attempt_count >= settings.RENDER_OUTBOX_MAX_ATTEMPTS
                else AsyncOperationStatusValue.RETRYING
            ),
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        )
        outbox.updated_at = now

    def target_type(self, db: Session, outbox_uuid: str) -> RenderTargetType | None:
        return db.execute(
            select(RenderOutbox.target_type).where(RenderOutbox.outbox_uuid == outbox_uuid)
        ).scalar_one_or_none()

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.DISPATCHED
        outbox.dispatched_at = now
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status != RenderOutboxStatus.DISPATCHED:
            return
        outbox.status = RenderOutboxStatus.PENDING
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.RENDER,
            status=AsyncOperationStatusValue.QUEUED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        )
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        dispatched_cutoff = now - timedelta(seconds=settings.RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS)
        processing_cutoff = now - timedelta(seconds=settings.RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS)
        stale = db.execute(
            select(RenderOutbox).where(
                or_(
                    RenderOutbox.status == RenderOutboxStatus.DISPATCHED,
                    RenderOutbox.status == RenderOutboxStatus.PROCESSING,
                )
            )
        ).scalars().all()
        for outbox in stale:
            is_stale_dispatch = (
                outbox.status == RenderOutboxStatus.DISPATCHED
                and outbox.dispatched_at is not None
                and outbox.dispatched_at <= dispatched_cutoff
            )
            is_stale_processing = (
                outbox.status == RenderOutboxStatus.PROCESSING
                and outbox.started_at is not None
                and outbox.started_at <= processing_cutoff
            )
            if is_stale_dispatch or is_stale_processing:
                outbox.status = RenderOutboxStatus.FAILED
                outbox.next_attempt_at = now
                outbox.last_error = "Render delivery lease expired"
                apply_async_diagnostic(
                    outbox,
                    kind=AsyncOperationKindValue.RENDER,
                    status=AsyncOperationStatusValue.FAILED,
                    raw_status=outbox.status.value,
                    last_error=outbox.last_error,
                    attempts=outbox.attempt_count,
                    max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
                )
                outbox.updated_at = now

        due = db.execute(
            select(RenderOutbox.outbox_uuid)
            .where(
                col(RenderOutbox.status).in_(
                    [RenderOutboxStatus.PENDING, RenderOutboxStatus.FAILED]
                ),
                RenderOutbox.next_attempt_at <= now,
                RenderOutbox.attempt_count < settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(RenderOutbox.created_at)
            .limit(settings.RENDER_OUTBOX_DISPATCH_BATCH_SIZE)
        ).scalars().all()
        db.commit()
        return list(due)

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> RenderOutbox | None:
        return db.execute(
            select(RenderOutbox).where(RenderOutbox.outbox_uuid == outbox_uuid)
        ).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: RenderOutbox) -> bool:
        return (
            outbox.status in {RenderOutboxStatus.PENDING, RenderOutboxStatus.FAILED}
            and outbox.attempt_count < settings.RENDER_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


render_outbox_service = RenderOutboxService()
