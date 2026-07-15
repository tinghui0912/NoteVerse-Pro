from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models import (
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    MailOutbox,
    MailOutboxStatus,
    OpsAuditEvent,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    RenderOutbox,
    RenderOutboxStatus,
    Score,
    ScoreDeletionStatus,
)
from app.modules.ops.schemas import (
    AsyncOperationDiagnostic,
    AsyncOperationErrorClass,
    AsyncOperationKind,
    AsyncOperationKindSummary,
    AsyncOperationRead,
    AsyncOperationsSummaryRead,
    AsyncOperationStatus,
    AsyncOperationStatusCount,
    OpsAuditEventRead,
    OpsAuditOutcome,
)
from app.shared.pagination import OffsetPage
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class AsyncOperationFilters:
    status: AsyncOperationStatus | None = None
    error_class: AsyncOperationErrorClass | None = None
    resource_type: str | None = None
    created_after: datetime | None = None
    updated_before: datetime | None = None

    @property
    def has_filters(self) -> bool:
        return any(
            value is not None
            for value in (
                self.status,
                self.error_class,
                self.resource_type,
                self.created_after,
                self.updated_before,
            )
        )


class OpsAsyncOperationService:
    async def list_audit_events(
        self,
        db: AsyncSession,
        *,
        limit: int,
        offset: int = 0,
        actor_user_id: int | None = None,
        action: str | None = None,
        operation_kind: AsyncOperationKind | None = None,
        operation_id: str | None = None,
        outcome: OpsAuditOutcome | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> OffsetPage[OpsAuditEventRead]:
        statement = select(OpsAuditEvent)
        if actor_user_id is not None:
            statement = statement.where(OpsAuditEvent.actor_user_id == actor_user_id)
        if action is not None:
            statement = statement.where(OpsAuditEvent.action == action)
        if operation_kind is not None:
            statement = statement.where(OpsAuditEvent.operation_kind == operation_kind.value)
        if operation_id is not None:
            statement = statement.where(OpsAuditEvent.operation_id == operation_id)
        if outcome is not None:
            statement = statement.where(OpsAuditEvent.outcome == outcome.value)
        if created_after is not None:
            statement = statement.where(OpsAuditEvent.created_at >= created_after)
        if created_before is not None:
            statement = statement.where(OpsAuditEvent.created_at <= created_before)
        result = await db.execute(
            statement.order_by(OpsAuditEvent.created_at.desc()).offset(offset).limit(limit + 1)
        )
        events = [self._audit_event_read(event) for event in result.scalars().all()]
        return OffsetPage(
            items=events[:limit],
            limit=limit,
            offset=offset,
            has_more=len(events) > limit,
        )

    async def record_audit_event(
        self,
        db: AsyncSession,
        *,
        actor_user_id: int | None,
        action: str,
        operation_kind: AsyncOperationKind,
        operation_id: str,
        outcome: str,
        error_code: str | None = None,
        error_detail: str | None = None,
    ) -> None:
        db.add(
            OpsAuditEvent(
                actor_user_id=actor_user_id,
                action=action,
                operation_kind=operation_kind.value,
                operation_id=operation_id,
                outcome=outcome,
                error_code=error_code,
                error_detail=error_detail,
            )
        )
        await db.commit()

    @staticmethod
    def _audit_event_read(event: OpsAuditEvent) -> OpsAuditEventRead:
        return OpsAuditEventRead(
            event_id=event.event_uuid,
            actor_user_id=event.actor_user_id,
            action=event.action,
            operation_kind=AsyncOperationKind(event.operation_kind),
            operation_id=event.operation_id,
            outcome=OpsAuditOutcome(event.outcome),
            error_code=event.error_code,
            error_detail=event.error_detail,
            created_at=event.created_at,
        )

    async def list_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
        offset: int = 0,
        kind: AsyncOperationKind | None = None,
        status: AsyncOperationStatus | None = None,
        error_class: AsyncOperationErrorClass | None = None,
        resource_type: str | None = None,
        created_after: datetime | None = None,
        updated_before: datetime | None = None,
    ) -> OffsetPage[AsyncOperationRead]:
        filters = AsyncOperationFilters(
            status=status,
            error_class=error_class,
            resource_type=resource_type,
            created_after=created_after,
            updated_before=updated_before,
        )
        source_limit = 5000 if filters.has_filters else offset + limit + 1
        operations: list[AsyncOperationRead] = []
        if kind in {None, AsyncOperationKind.IMPORT}:
            operations.extend(await self._import_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.RENDER}:
            operations.extend(await self._render_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.PLAYBACK}:
            operations.extend(await self._playback_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.MAIL}:
            operations.extend(await self._mail_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.SCORE_DELETION}:
            operations.extend(await self._score_deletion_operations(db, limit=source_limit))
        operations = [operation for operation in operations if self._matches_filters(operation, filters)]
        sorted_operations = sorted(
            operations,
            key=lambda operation: operation.updated_at or operation.created_at or datetime.min,
            reverse=True,
        )
        page_items = sorted_operations[offset : offset + limit]
        return OffsetPage(
            items=page_items,
            limit=limit,
            offset=offset,
            has_more=len(sorted_operations) > offset + limit,
        )

    async def summary(
        self,
        db: AsyncSession,
        *,
        kind: AsyncOperationKind | None = None,
        status: AsyncOperationStatus | None = None,
        error_class: AsyncOperationErrorClass | None = None,
        resource_type: str | None = None,
        created_after: datetime | None = None,
        updated_before: datetime | None = None,
    ) -> AsyncOperationsSummaryRead:
        filters = AsyncOperationFilters(
            status=status,
            error_class=error_class,
            resource_type=resource_type,
            created_after=created_after,
            updated_before=updated_before,
        )
        rows = await self._summary_rows(db, kind=kind, filters=filters)
        total_statuses: Counter[AsyncOperationStatus] = Counter()
        kind_statuses: dict[AsyncOperationKind, Counter[AsyncOperationStatus]] = defaultdict(Counter)
        total = 0
        for row_kind, row_status, count in rows:
            total += count
            total_statuses[row_status] += count
            kind_statuses[row_kind][row_status] += count
        return AsyncOperationsSummaryRead(
            total=total,
            statuses=self._status_counts(total_statuses),
            kinds=[
                AsyncOperationKindSummary(
                    kind=kind,
                    total=sum(counter.values()),
                    statuses=self._status_counts(counter),
                )
                for kind, counter in sorted(kind_statuses.items(), key=lambda item: item[0].value)
            ],
        )

    async def retry_operation(
        self,
        db: AsyncSession,
        *,
        kind: AsyncOperationKind,
        operation_id: str,
    ) -> AsyncOperationRead:
        if kind == AsyncOperationKind.IMPORT:
            return await self._retry_import(db, operation_id)
        if kind == AsyncOperationKind.RENDER:
            return await self._retry_render(db, operation_id)
        if kind == AsyncOperationKind.PLAYBACK:
            return await self._retry_playback(db, operation_id)
        if kind == AsyncOperationKind.MAIL:
            return await self._retry_mail(db, operation_id)
        if kind == AsyncOperationKind.SCORE_DELETION:
            return await self._retry_score_deletion(db, operation_id)
        raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="kind")

    async def _summary_rows(
        self,
        db: AsyncSession,
        *,
        kind: AsyncOperationKind | None,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        rows: list[tuple[AsyncOperationKind, AsyncOperationStatus, int]] = []
        if kind in {None, AsyncOperationKind.IMPORT}:
            rows.extend(await self._import_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.RENDER}:
            rows.extend(await self._render_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.PLAYBACK}:
            rows.extend(await self._playback_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.MAIL}:
            rows.extend(await self._mail_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.SCORE_DELETION}:
            rows.extend(await self._score_deletion_summary_rows(db, filters))
        return rows

    async def _import_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = case(
            (
                ImportJob.state.in_([ImportJobState.PENDING_REVIEW, ImportJobState.CONFIRMED]),
                AsyncOperationStatus.SUCCEEDED.value,
            ),
            (
                (ImportJob.state == ImportJobState.RUNNING)
                | (ImportJob.dispatch_status == ImportDispatchStatus.PROCESSING),
                AsyncOperationStatus.PROCESSING.value,
            ),
            (
                ImportJob.dispatch_status == ImportDispatchStatus.DISPATCHED,
                AsyncOperationStatus.DISPATCHED.value,
            ),
            (
                (ImportJob.state == ImportJobState.FAILURE)
                & (ImportJob.dispatch_attempt_count >= settings.IMPORT_DISPATCH_MAX_ATTEMPTS),
                AsyncOperationStatus.EXHAUSTED.value,
            ),
            (ImportJob.state == ImportJobState.FAILURE, AsyncOperationStatus.FAILED.value),
            (
                ImportJob.dispatch_status == ImportDispatchStatus.FAILED,
                AsyncOperationStatus.RETRYING.value,
            ),
            else_=AsyncOperationStatus.QUEUED.value,
        )
        error_class_expr = self._error_class_sql(func.coalesce(ImportJob.error, ImportJob.dispatch_error))
        predicates = self._summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=error_class_expr,
            resource_type_expr=literal("import_job"),
            created_at_expr=ImportJob.created_at,
            updated_at_expr=ImportJob.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(ImportJob)
            .where(*predicates)
            .group_by(status_expr)
        )
        return self._summary_result_rows(AsyncOperationKind.IMPORT, result.all())

    async def _render_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = self._outbox_status_sql(
            RenderOutbox.status,
            RenderOutbox.attempt_count,
            settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            RenderOutbox.next_attempt_at,
        )
        error_class_expr = self._error_class_sql(RenderOutbox.last_error)
        predicates = self._summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=error_class_expr,
            resource_type_expr=func.lower(RenderOutbox.target_type),
            created_at_expr=RenderOutbox.created_at,
            updated_at_expr=RenderOutbox.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(RenderOutbox)
            .where(*predicates)
            .group_by(status_expr)
        )
        return self._summary_result_rows(AsyncOperationKind.RENDER, result.all())

    async def _playback_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = self._outbox_status_sql(
            PlaybackOutbox.status,
            PlaybackOutbox.attempt_count,
            settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            PlaybackOutbox.next_attempt_at,
        )
        error_class_expr = self._error_class_sql(PlaybackOutbox.last_error)
        predicates = self._summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=error_class_expr,
            resource_type_expr=func.lower(PlaybackOutbox.asset_kind),
            created_at_expr=PlaybackOutbox.created_at,
            updated_at_expr=PlaybackOutbox.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(PlaybackOutbox)
            .where(*predicates)
            .group_by(status_expr)
        )
        return self._summary_result_rows(AsyncOperationKind.PLAYBACK, result.all())

    async def _mail_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = case(
            (MailOutbox.status == MailOutboxStatus.SENT, AsyncOperationStatus.SUCCEEDED.value),
            (MailOutbox.status == MailOutboxStatus.PROCESSING, AsyncOperationStatus.PROCESSING.value),
            (MailOutbox.status == MailOutboxStatus.DISPATCHED, AsyncOperationStatus.DISPATCHED.value),
            (
                MailOutbox.status == MailOutboxStatus.PERMANENT_FAILURE,
                AsyncOperationStatus.PERMANENT_FAILED.value,
            ),
            (MailOutbox.status == MailOutboxStatus.EXPIRED, AsyncOperationStatus.EXPIRED.value),
            (
                (MailOutbox.status == MailOutboxStatus.FAILED)
                & (MailOutbox.attempt_count >= settings.MAIL_OUTBOX_MAX_ATTEMPTS),
                AsyncOperationStatus.EXHAUSTED.value,
            ),
            (MailOutbox.status == MailOutboxStatus.FAILED, AsyncOperationStatus.RETRYING.value),
            else_=AsyncOperationStatus.QUEUED.value,
        )
        error_class_expr = self._error_class_sql(MailOutbox.last_error)
        predicates = self._summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=error_class_expr,
            resource_type_expr=MailOutbox.category,
            created_at_expr=MailOutbox.created_at,
            updated_at_expr=MailOutbox.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(MailOutbox)
            .where(*predicates)
            .group_by(status_expr)
        )
        return self._summary_result_rows(AsyncOperationKind.MAIL, result.all())

    async def _score_deletion_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = case(
            (
                Score.cleanup_attempt_count >= settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
                AsyncOperationStatus.EXHAUSTED.value,
            ),
            (Score.cleanup_attempt_count > 0, AsyncOperationStatus.RETRYING.value),
            else_=AsyncOperationStatus.QUEUED.value,
        )
        error_class_expr = self._error_class_sql(Score.deletion_error)
        created_at_expr = func.coalesce(Score.deletion_requested_at, Score.deleted_at)
        predicates = [
            Score.deletion_status == ScoreDeletionStatus.DELETING,
            *self._summary_predicates(
                filters,
                status_expr=status_expr,
                error_class_expr=error_class_expr,
                resource_type_expr=literal("score"),
                created_at_expr=created_at_expr,
                updated_at_expr=Score.updated_at,
            ),
        ]
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(Score)
            .where(*predicates)
            .group_by(status_expr)
        )
        return self._summary_result_rows(AsyncOperationKind.SCORE_DELETION, result.all())

    async def _import_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(select(ImportJob).order_by(ImportJob.updated_at.desc()).limit(limit))
        ).scalars()
        return [self._read_import(job) for job in rows]

    async def _render_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(select(RenderOutbox).order_by(RenderOutbox.updated_at.desc()).limit(limit))
        ).scalars()
        return [self._read_render(outbox) for outbox in rows]

    async def _playback_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(
                select(PlaybackOutbox).order_by(PlaybackOutbox.updated_at.desc()).limit(limit)
            )
        ).scalars()
        return [self._read_playback(outbox) for outbox in rows]

    async def _mail_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(select(MailOutbox).order_by(MailOutbox.updated_at.desc()).limit(limit))
        ).scalars()
        return [self._read_mail(outbox) for outbox in rows]

    async def _score_deletion_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(
                select(Score)
                .where(Score.deletion_status == ScoreDeletionStatus.DELETING)
                .order_by(Score.updated_at.desc())
                .limit(limit)
            )
        ).scalars()
        return [self._read_score_deletion(score) for score in rows]

    async def _retry_import(self, db: AsyncSession, operation_id: str) -> AsyncOperationRead:
        job = (
            await db.execute(
                select(ImportJob).where(ImportJob.job_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if job is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        if job.state in {ImportJobState.RUNNING, ImportJobState.PENDING_REVIEW, ImportJobState.CONFIRMED}:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": self._import_status(job).value},
            )
        now = utc_now_naive()
        job.state = ImportJobState.PENDING
        job.progress = 0
        job.current_step = None
        job.dispatch_status = ImportDispatchStatus.PENDING
        job.dispatch_attempt_count = 0
        job.publish_attempt_count = 0
        job.next_dispatch_at = now
        job.dispatched_at = None
        job.dispatch_started_at = None
        job.dispatch_completed_at = None
        job.dispatch_error = None
        job.error = None
        job.error_type = None
        job.started_at = None
        job.finished_at = None
        job.updated_at = now
        await db.commit()
        await db.refresh(job)
        return self._read_import(job)

    async def _retry_render(self, db: AsyncSession, operation_id: str) -> AsyncOperationRead:
        outbox = (
            await db.execute(
                select(RenderOutbox).where(RenderOutbox.outbox_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        if outbox.status in {
            RenderOutboxStatus.PROCESSING,
            RenderOutboxStatus.DISPATCHED,
            RenderOutboxStatus.COMPLETED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": self._read_render(outbox).status.value},
            )
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        outbox.updated_at = now
        await db.commit()
        await db.refresh(outbox)
        return self._read_render(outbox)

    async def _retry_playback(self, db: AsyncSession, operation_id: str) -> AsyncOperationRead:
        outbox = (
            await db.execute(
                select(PlaybackOutbox)
                .where(PlaybackOutbox.outbox_uuid == operation_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        if outbox.status in {
            PlaybackOutboxStatus.PROCESSING,
            PlaybackOutboxStatus.DISPATCHED,
            PlaybackOutboxStatus.COMPLETED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": self._read_playback(outbox).status.value},
            )
        now = utc_now_naive()
        outbox.status = PlaybackOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        outbox.updated_at = now
        await db.commit()
        await db.refresh(outbox)
        return self._read_playback(outbox)

    async def _retry_mail(self, db: AsyncSession, operation_id: str) -> AsyncOperationRead:
        outbox = (
            await db.execute(
                select(MailOutbox).where(MailOutbox.outbox_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
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
                details={"status": self._mail_status(outbox).value},
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
        outbox.updated_at = now
        await db.commit()
        await db.refresh(outbox)
        return self._read_mail(outbox)

    async def _retry_score_deletion(self, db: AsyncSession, operation_id: str) -> AsyncOperationRead:
        score = (
            await db.execute(
                select(Score).where(Score.score_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if score is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        if score.deletion_status != ScoreDeletionStatus.DELETING:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": score.deletion_status.value},
            )
        now = utc_now_naive()
        score.cleanup_attempt_count = 0
        score.next_cleanup_at = now
        score.deletion_error = None
        score.updated_at = now
        await db.commit()
        await db.refresh(score)
        return self._read_score_deletion(score)

    def _read_import(self, job: ImportJob) -> AsyncOperationRead:
        return AsyncOperationRead(
            operation_id=job.job_uuid,
            kind=AsyncOperationKind.IMPORT,
            resource_type="import_job",
            resource_id=job.job_uuid,
            status=self._import_status(job),
            raw_status=f"{job.state.value}/{job.dispatch_status.value}",
            attempts=job.dispatch_attempt_count,
            max_attempts=settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
            next_attempt_at=job.next_dispatch_at,
            last_error=job.error or job.dispatch_error,
            error_class=self._classify_error(job.error or job.dispatch_error),
            diagnostic=self._diagnostic(
                kind=AsyncOperationKind.IMPORT,
                status=self._import_status(job),
                raw_status=f"{job.state.value}/{job.dispatch_status.value}",
                last_error=job.error or job.dispatch_error,
                attempts=job.dispatch_attempt_count,
                max_attempts=settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
            ),
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    def _read_render(self, outbox: RenderOutbox) -> AsyncOperationRead:
        status = self._outbox_status(
            outbox.status,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            next_attempt_at=outbox.next_attempt_at,
        )
        return AsyncOperationRead(
            operation_id=outbox.outbox_uuid,
            kind=AsyncOperationKind.RENDER,
            resource_type=outbox.target_type.value.lower(),
            resource_id=outbox.outbox_uuid,
            status=status,
            raw_status=outbox.status.value,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            next_attempt_at=outbox.next_attempt_at,
            last_error=outbox.last_error,
            error_class=self._classify_error(outbox.last_error),
            diagnostic=self._diagnostic(
                kind=AsyncOperationKind.RENDER,
                status=status,
                raw_status=outbox.status.value,
                last_error=outbox.last_error,
                attempts=outbox.attempt_count,
                max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            ),
            created_at=outbox.created_at,
            updated_at=outbox.updated_at,
        )

    def _read_playback(self, outbox: PlaybackOutbox) -> AsyncOperationRead:
        status = self._outbox_status(
            outbox.status,
            attempts=outbox.attempt_count,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            next_attempt_at=outbox.next_attempt_at,
        )
        return AsyncOperationRead(
            operation_id=outbox.outbox_uuid,
            kind=AsyncOperationKind.PLAYBACK,
            resource_type=outbox.asset_kind.value.lower(),
            resource_id=outbox.outbox_uuid,
            status=status,
            raw_status=outbox.status.value,
            attempts=outbox.attempt_count,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            next_attempt_at=outbox.next_attempt_at,
            last_error=outbox.last_error,
            error_class=self._classify_error(outbox.last_error),
            diagnostic=self._diagnostic(
                kind=AsyncOperationKind.PLAYBACK,
                status=status,
                raw_status=outbox.status.value,
                last_error=outbox.last_error,
                attempts=outbox.attempt_count,
                max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            ),
            created_at=outbox.created_at,
            updated_at=outbox.updated_at,
        )

    def _read_mail(self, outbox: MailOutbox) -> AsyncOperationRead:
        status = self._mail_status(outbox)
        return AsyncOperationRead(
            operation_id=outbox.outbox_uuid,
            kind=AsyncOperationKind.MAIL,
            resource_type=outbox.category,
            resource_id=outbox.outbox_uuid,
            status=status,
            raw_status=outbox.status.value,
            attempts=outbox.attempt_count,
            max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            next_attempt_at=outbox.next_attempt_at,
            last_error=outbox.last_error,
            error_class=self._classify_error(outbox.last_error),
            diagnostic=self._diagnostic(
                kind=AsyncOperationKind.MAIL,
                status=status,
                raw_status=outbox.status.value,
                last_error=outbox.last_error,
                attempts=outbox.attempt_count,
                max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
            ),
            created_at=outbox.created_at,
            updated_at=outbox.updated_at,
        )

    def _read_score_deletion(self, score: Score) -> AsyncOperationRead:
        status = self._score_deletion_status(score)
        return AsyncOperationRead(
            operation_id=score.score_uuid,
            kind=AsyncOperationKind.SCORE_DELETION,
            resource_type="score",
            resource_id=score.score_uuid,
            status=status,
            raw_status=score.deletion_status.value,
            attempts=score.cleanup_attempt_count,
            max_attempts=settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
            next_attempt_at=score.next_cleanup_at,
            last_error=score.deletion_error,
            error_class=self._classify_error(score.deletion_error),
            diagnostic=self._diagnostic(
                kind=AsyncOperationKind.SCORE_DELETION,
                status=status,
                raw_status=score.deletion_status.value,
                last_error=score.deletion_error,
                attempts=score.cleanup_attempt_count,
                max_attempts=settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
            ),
            created_at=score.deletion_requested_at or score.deleted_at,
            updated_at=score.updated_at,
        )

    @staticmethod
    def _outbox_status_sql(status_column, attempt_count_column, max_attempts: int, next_attempt_at_column):
        return case(
            (status_column == "COMPLETED", AsyncOperationStatus.SUCCEEDED.value),
            (status_column == "PROCESSING", AsyncOperationStatus.PROCESSING.value),
            (status_column == "DISPATCHED", AsyncOperationStatus.DISPATCHED.value),
            (
                (status_column == "FAILED") & (attempt_count_column >= max_attempts),
                AsyncOperationStatus.EXHAUSTED.value,
            ),
            (
                (status_column == "FAILED") & (next_attempt_at_column > utc_now_naive()),
                AsyncOperationStatus.RETRYING.value,
            ),
            (status_column == "FAILED", AsyncOperationStatus.FAILED.value),
            else_=AsyncOperationStatus.QUEUED.value,
        )

    @staticmethod
    def _error_class_sql(error_column):
        normalized = func.lower(func.coalesce(error_column, ""))
        return case(
            (normalized == "", None),
            (
                normalized.like("%unsupported%")
                | normalized.like("%invalid file%")
                | normalized.like("%invalid input%")
                | normalized.like("%corrupt%")
                | normalized.like("%parse%"),
                AsyncOperationErrorClass.USER_ERROR.value,
            ),
            (
                normalized.like("%references unavailable%")
                | normalized.like("%stale resources%")
                | normalized.like("%body is unavailable%")
                | normalized.like("%permanent%")
                | normalized.like("%expired%"),
                AsyncOperationErrorClass.PERMANENT.value,
            ),
            (
                normalized.like("%timeout%")
                | normalized.like("%temporarily%")
                | normalized.like("%unavailable%")
                | normalized.like("%connection%")
                | normalized.like("%lease expired%")
                | normalized.like("%worker%")
                | normalized.like("%redis%")
                | normalized.like("%s3%")
                | normalized.like("%storage%")
                | normalized.like("%smtp%"),
                AsyncOperationErrorClass.TRANSIENT.value,
            ),
            (
                normalized.like("%traceback%")
                | normalized.like("%exception%")
                | normalized.like("%failed%"),
                AsyncOperationErrorClass.SYSTEM_ERROR.value,
            ),
            else_=AsyncOperationErrorClass.UNKNOWN.value,
        )

    @staticmethod
    def _summary_predicates(
        filters: AsyncOperationFilters,
        *,
        status_expr,
        error_class_expr,
        resource_type_expr,
        created_at_expr,
        updated_at_expr,
    ) -> list[object]:
        predicates: list[object] = []
        if filters.status is not None:
            predicates.append(status_expr == filters.status.value)
        if filters.error_class is not None:
            predicates.append(error_class_expr == filters.error_class.value)
        if filters.resource_type is not None:
            predicates.append(resource_type_expr == filters.resource_type)
        if filters.created_after is not None:
            predicates.append(created_at_expr >= filters.created_after)
        if filters.updated_before is not None:
            predicates.append(updated_at_expr <= filters.updated_before)
        return predicates

    @staticmethod
    def _summary_result_rows(
        kind: AsyncOperationKind,
        rows: list[tuple[object, int]],
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        return [
            (kind, AsyncOperationStatus(str(status)), int(count))
            for status, count in rows
        ]

    @staticmethod
    def _import_status(job: ImportJob) -> AsyncOperationStatus:
        if job.state in {ImportJobState.PENDING_REVIEW, ImportJobState.CONFIRMED}:
            return AsyncOperationStatus.SUCCEEDED
        if job.state == ImportJobState.RUNNING or job.dispatch_status == ImportDispatchStatus.PROCESSING:
            return AsyncOperationStatus.PROCESSING
        if job.dispatch_status == ImportDispatchStatus.DISPATCHED:
            return AsyncOperationStatus.DISPATCHED
        if job.state == ImportJobState.FAILURE:
            if job.dispatch_attempt_count >= settings.IMPORT_DISPATCH_MAX_ATTEMPTS:
                return AsyncOperationStatus.EXHAUSTED
            return AsyncOperationStatus.FAILED
        if job.dispatch_status == ImportDispatchStatus.FAILED:
            return AsyncOperationStatus.RETRYING
        return AsyncOperationStatus.QUEUED

    @staticmethod
    def _outbox_status(
        status: RenderOutboxStatus | PlaybackOutboxStatus,
        *,
        attempts: int,
        max_attempts: int,
        next_attempt_at: datetime,
    ) -> AsyncOperationStatus:
        if status.value == "COMPLETED":
            return AsyncOperationStatus.SUCCEEDED
        if status.value == "PROCESSING":
            return AsyncOperationStatus.PROCESSING
        if status.value == "DISPATCHED":
            return AsyncOperationStatus.DISPATCHED
        if status.value == "FAILED":
            if attempts >= max_attempts:
                return AsyncOperationStatus.EXHAUSTED
            if next_attempt_at > utc_now_naive():
                return AsyncOperationStatus.RETRYING
            return AsyncOperationStatus.FAILED
        return AsyncOperationStatus.QUEUED

    @staticmethod
    def _mail_status(outbox: MailOutbox) -> AsyncOperationStatus:
        if outbox.status == MailOutboxStatus.SENT:
            return AsyncOperationStatus.SUCCEEDED
        if outbox.status == MailOutboxStatus.PROCESSING:
            return AsyncOperationStatus.PROCESSING
        if outbox.status == MailOutboxStatus.DISPATCHED:
            return AsyncOperationStatus.DISPATCHED
        if outbox.status == MailOutboxStatus.PERMANENT_FAILURE:
            return AsyncOperationStatus.PERMANENT_FAILED
        if outbox.status == MailOutboxStatus.EXPIRED:
            return AsyncOperationStatus.EXPIRED
        if outbox.status == MailOutboxStatus.FAILED:
            if outbox.attempt_count >= settings.MAIL_OUTBOX_MAX_ATTEMPTS:
                return AsyncOperationStatus.EXHAUSTED
            return AsyncOperationStatus.RETRYING
        return AsyncOperationStatus.QUEUED

    @staticmethod
    def _score_deletion_status(score: Score) -> AsyncOperationStatus:
        if score.cleanup_attempt_count >= settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS:
            return AsyncOperationStatus.EXHAUSTED
        if score.cleanup_attempt_count > 0:
            return AsyncOperationStatus.RETRYING
        return AsyncOperationStatus.QUEUED

    @staticmethod
    def _matches_filters(
        operation: AsyncOperationRead,
        filters: AsyncOperationFilters,
    ) -> bool:
        if filters.status is not None and operation.status != filters.status:
            return False
        if filters.error_class is not None and operation.error_class != filters.error_class:
            return False
        if filters.resource_type is not None and operation.resource_type != filters.resource_type:
            return False
        if (
            filters.created_after is not None
            and operation.created_at is not None
            and operation.created_at < filters.created_after
        ):
            return False
        if (
            filters.created_after is not None
            and operation.created_at is None
        ):
            return False
        if (
            filters.updated_before is not None
            and operation.updated_at is not None
            and operation.updated_at > filters.updated_before
        ):
            return False
        if (
            filters.updated_before is not None
            and operation.updated_at is None
        ):
            return False
        return True

    @staticmethod
    def _classify_error(error: str | None) -> AsyncOperationErrorClass | None:
        if not error:
            return None
        normalized = error.lower()
        if any(
            marker in normalized
            for marker in (
                "unsupported",
                "invalid file",
                "invalid input",
                "corrupt",
                "parse",
            )
        ):
            return AsyncOperationErrorClass.USER_ERROR
        if any(
            marker in normalized
            for marker in (
                "references unavailable",
                "stale resources",
                "body is unavailable",
                "permanent",
                "expired",
            )
        ):
            return AsyncOperationErrorClass.PERMANENT
        if any(
            marker in normalized
            for marker in (
                "timeout",
                "temporarily",
                "unavailable",
                "connection",
                "lease expired",
                "worker",
                "redis",
                "s3",
                "storage",
                "smtp",
            )
        ):
            return AsyncOperationErrorClass.TRANSIENT
        if any(marker in normalized for marker in ("traceback", "exception", "failed")):
            return AsyncOperationErrorClass.SYSTEM_ERROR
        return AsyncOperationErrorClass.UNKNOWN

    def _diagnostic(
        self,
        *,
        kind: AsyncOperationKind,
        status: AsyncOperationStatus,
        raw_status: str,
        last_error: str | None,
        attempts: int,
        max_attempts: int | None,
    ) -> AsyncOperationDiagnostic | None:
        error_class = self._classify_error(last_error)
        if last_error is None and error_class is None and status not in {
            AsyncOperationStatus.FAILED,
            AsyncOperationStatus.PERMANENT_FAILED,
            AsyncOperationStatus.EXPIRED,
            AsyncOperationStatus.EXHAUSTED,
            AsyncOperationStatus.BLOCKED,
        }:
            return None

        internal_code = self._internal_code(
            kind=kind,
            status=status,
            raw_status=raw_status,
            error_class=error_class,
            last_error=last_error,
        )
        retryable = self._is_retryable(status=status, attempts=attempts, max_attempts=max_attempts)
        return AsyncOperationDiagnostic(
            internal_code=internal_code,
            internal_stage=self._internal_stage(kind, raw_status),
            internal_reason=last_error,
            retryable=retryable,
        )

    @staticmethod
    def _internal_stage(kind: AsyncOperationKind, raw_status: str) -> str:
        if kind == AsyncOperationKind.IMPORT:
            if "/" in raw_status:
                state, dispatch = raw_status.split("/", 1)
                if dispatch in {"PENDING", "DISPATCHED", "FAILED"}:
                    return "dispatch"
                return state.lower()
            return "import"
        if kind == AsyncOperationKind.RENDER:
            return "render"
        if kind == AsyncOperationKind.PLAYBACK:
            return "playback"
        if kind == AsyncOperationKind.MAIL:
            return "delivery"
        if kind == AsyncOperationKind.SCORE_DELETION:
            return "cleanup"
        return kind.value

    @staticmethod
    def _internal_code(
        *,
        kind: AsyncOperationKind,
        status: AsyncOperationStatus,
        raw_status: str,
        error_class: AsyncOperationErrorClass | None,
        last_error: str | None,
    ) -> str:
        normalized = (last_error or raw_status).lower()
        if status == AsyncOperationStatus.EXPIRED or "expired" in normalized:
            return f"{kind.value}_expired"
        if status == AsyncOperationStatus.EXHAUSTED:
            return f"{kind.value}_attempts_exhausted"
        if "lease expired" in normalized:
            return f"{kind.value}_lease_expired"
        if "references unavailable" in normalized or "stale resources" in normalized:
            return f"{kind.value}_stale_resources"
        if "body is unavailable" in normalized:
            return f"{kind.value}_body_unavailable"
        if "timeout" in normalized:
            return f"{kind.value}_timeout"
        if error_class == AsyncOperationErrorClass.TRANSIENT:
            return f"{kind.value}_transient_failure"
        if error_class == AsyncOperationErrorClass.PERMANENT:
            return f"{kind.value}_permanent_failure"
        if error_class == AsyncOperationErrorClass.USER_ERROR:
            return f"{kind.value}_user_input_error"
        if error_class == AsyncOperationErrorClass.SYSTEM_ERROR:
            return f"{kind.value}_system_failure"
        if error_class == AsyncOperationErrorClass.UNKNOWN:
            return f"{kind.value}_unknown_failure"
        return f"{kind.value}_status_{status.value}"

    @staticmethod
    def _is_retryable(
        *,
        status: AsyncOperationStatus,
        attempts: int,
        max_attempts: int | None,
    ) -> bool:
        if status in {
            AsyncOperationStatus.SUCCEEDED,
            AsyncOperationStatus.PROCESSING,
            AsyncOperationStatus.DISPATCHED,
            AsyncOperationStatus.PERMANENT_FAILED,
            AsyncOperationStatus.EXPIRED,
            AsyncOperationStatus.EXHAUSTED,
            AsyncOperationStatus.BLOCKED,
        }:
            return False
        if max_attempts is not None and attempts >= max_attempts:
            return False
        return status in {
            AsyncOperationStatus.QUEUED,
            AsyncOperationStatus.RETRYING,
            AsyncOperationStatus.FAILED,
        }

    @staticmethod
    def _status_counts(
        counter: Counter[AsyncOperationStatus],
    ) -> list[AsyncOperationStatusCount]:
        return [
            AsyncOperationStatusCount(status=status, count=count)
            for status, count in sorted(counter.items(), key=lambda item: item[0].value)
        ]


ops_async_operation_service = OpsAsyncOperationService()
