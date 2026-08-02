"""Prometheus metrics derived from async operation tables."""

from __future__ import annotations

from collections.abc import Iterable

from datetime import timedelta

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import (
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    MailOutbox,
    MailOutboxStatus,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    RenderOutbox,
    RenderOutboxStatus,
    SchedulerHeartbeat,
    SchedulerLeaderStatus,
    Score,
)
from app.modules.scheduler_lock.constants import BEAT_LEADER_SCHEDULER_NAME
from app.modules.scheduler_observability.service import scheduler_observability_service
from app.utils.timezone import utc_now_naive


async def async_operation_metrics_text(db: AsyncSession) -> str:
    """Return current async operation state metrics in Prometheus text format."""

    lines = [
        "# HELP noteverse_import_jobs_by_state Import jobs grouped by current business state.",
        "# TYPE noteverse_import_jobs_by_state gauge",
        *await _enum_count_lines(
            db,
            statement=select(ImportJob.state, func.count()).group_by(ImportJob.state),
            metric_name="noteverse_import_jobs_by_state",
            label_names=("state",),
        ),
        "# HELP noteverse_outbox_records_by_status Outbox records grouped by kind and status.",
        "# TYPE noteverse_outbox_records_by_status gauge",
        *await _enum_count_lines(
            db,
            statement=select(RenderOutbox.status, func.count()).group_by(RenderOutbox.status),
            metric_name="noteverse_outbox_records_by_status",
            label_names=("kind", "status"),
            fixed_labels=("render",),
        ),
        *await _enum_count_lines(
            db,
            statement=select(PlaybackOutbox.status, func.count()).group_by(PlaybackOutbox.status),
            metric_name="noteverse_outbox_records_by_status",
            label_names=("kind", "status"),
            fixed_labels=("playback",),
        ),
        *await _enum_count_lines(
            db,
            statement=select(MailOutbox.status, func.count()).group_by(MailOutbox.status),
            metric_name="noteverse_outbox_records_by_status",
            label_names=("kind", "status"),
            fixed_labels=("mail",),
        ),
        "# HELP noteverse_score_deletions_by_status Score deletion cleanup records grouped by status.",
        "# TYPE noteverse_score_deletions_by_status gauge",
        *await _enum_count_lines(
            db,
            statement=select(Score.deletion_status, func.count()).group_by(Score.deletion_status),
            metric_name="noteverse_score_deletions_by_status",
            label_names=("status",),
        ),
        "# HELP noteverse_async_operation_oldest_open_age_seconds Oldest non-terminal async operation age in seconds.",
        "# TYPE noteverse_async_operation_oldest_open_age_seconds gauge",
        *await _oldest_open_age_lines(db),
        "# HELP noteverse_async_operation_oldest_processing_age_seconds Oldest currently processing async operation age in seconds.",
        "# TYPE noteverse_async_operation_oldest_processing_age_seconds gauge",
        *await _oldest_processing_age_lines(db),
        "# HELP noteverse_async_operation_completed_duration_average_seconds Average completed async operation duration in seconds over the last 24 hours.",
        "# TYPE noteverse_async_operation_completed_duration_average_seconds gauge",
        *await _completed_duration_average_lines(db),
        "# HELP noteverse_scheduler_last_success_timestamp_seconds Unix timestamp of the last successful scheduler scan.",
        "# TYPE noteverse_scheduler_last_success_timestamp_seconds gauge",
        "# HELP noteverse_scheduler_last_failure_timestamp_seconds Unix timestamp of the last failed scheduler scan.",
        "# TYPE noteverse_scheduler_last_failure_timestamp_seconds gauge",
        "# HELP noteverse_scheduler_last_scan_duration_seconds Duration of the most recent scheduler scan.",
        "# TYPE noteverse_scheduler_last_scan_duration_seconds gauge",
        "# HELP noteverse_scheduler_scan_duration_seconds Scheduler scan duration summary.",
        "# TYPE noteverse_scheduler_scan_duration_seconds summary",
        "# HELP noteverse_scheduler_last_due_records Number of records due in the most recent scheduler scan.",
        "# TYPE noteverse_scheduler_last_due_records gauge",
        "# HELP noteverse_scheduler_last_dispatched_records Number of records dispatched in the most recent scheduler scan.",
        "# TYPE noteverse_scheduler_last_dispatched_records gauge",
        "# HELP noteverse_scheduler_successes_total Total successful scheduler scans recorded by the scheduler.",
        "# TYPE noteverse_scheduler_successes_total counter",
        "# HELP noteverse_scheduler_failures_total Total failed scheduler scans recorded by the scheduler.",
        "# TYPE noteverse_scheduler_failures_total counter",
        "# HELP noteverse_scheduler_due_records_total Total due records observed by successful scheduler scans.",
        "# TYPE noteverse_scheduler_due_records_total counter",
        "# HELP noteverse_scheduler_dispatched_records_total Total records dispatched by successful scheduler scans.",
        "# TYPE noteverse_scheduler_dispatched_records_total counter",
        "# HELP noteverse_scheduler_lock_acquired_total Total scheduler scans that acquired the database scheduler lock.",
        "# TYPE noteverse_scheduler_lock_acquired_total counter",
        "# HELP noteverse_scheduler_lock_skipped_total Total scheduler scans skipped because another scheduler held the database scheduler lock.",
        "# TYPE noteverse_scheduler_lock_skipped_total counter",
        "# HELP noteverse_scheduler_last_lock_skipped_timestamp_seconds Unix timestamp of the last scheduler lock skip.",
        "# TYPE noteverse_scheduler_last_lock_skipped_timestamp_seconds gauge",
        *await _scheduler_heartbeat_lines(db),
        "# HELP noteverse_scheduler_leader_last_heartbeat_timestamp_seconds Unix timestamp of the active Beat leader heartbeat.",
        "# TYPE noteverse_scheduler_leader_last_heartbeat_timestamp_seconds gauge",
        "# HELP noteverse_scheduler_leader_active Whether a Beat leader heartbeat is current.",
        "# TYPE noteverse_scheduler_leader_active gauge",
        "# HELP noteverse_scheduler_leader_acquisitions_total Total successful Beat leader acquisitions.",
        "# TYPE noteverse_scheduler_leader_acquisitions_total counter",
        "# HELP noteverse_scheduler_leader_standby_total Total Beat standby observations.",
        "# TYPE noteverse_scheduler_leader_standby_total counter",
        "# HELP noteverse_scheduler_leader_child_exits_total Total unexpected Celery Beat child exits.",
        "# TYPE noteverse_scheduler_leader_child_exits_total counter",
        *await _scheduler_leader_lines(db),
        "# HELP noteverse_scheduler_lag_seconds Oldest due record delay before scheduler dispatch by async operation kind.",
        "# TYPE noteverse_scheduler_lag_seconds gauge",
        *await _scheduler_lag_lines(db),
    ]
    return "\n".join(lines) + "\n"


async def _enum_count_lines(
    db: AsyncSession,
    *,
    statement: Select[tuple[object, int]],
    metric_name: str,
    label_names: tuple[str, ...],
    fixed_labels: tuple[str, ...] = (),
) -> list[str]:
    result = await db.exec(statement)
    lines: list[str] = []
    for value, count in result.all():
        label_values = (*fixed_labels, _metric_label_value(value))
        lines.append(_metric_line(metric_name, label_names, label_values, int(count)))
    return lines


def _metric_label_value(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw).lower()


def _metric_line(
    metric_name: str,
    label_names: Iterable[str],
    label_values: Iterable[str],
    value: int | float,
) -> str:
    labels = ",".join(
        f'{name}="{_escape_label_value(label_value)}"'
        for name, label_value in zip(label_names, label_values, strict=True)
    )
    suffix = f"{{{labels}}}" if labels else ""
    return f"{metric_name}{suffix} {value}"


def _metric_float_line(
    metric_name: str,
    label_names: Iterable[str],
    label_values: Iterable[str],
    value: float,
) -> str:
    return _metric_line(metric_name, label_names, label_values, round(value, 3))


def _escape_label_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


async def _oldest_open_age_lines(db: AsyncSession) -> list[str]:
    now = utc_now_naive()
    rows = [
        (
            "import",
            await _oldest_age_seconds(
                db,
                select(func.min(ImportJob.created_at)).where(
                    ImportJob.dispatch_status != ImportDispatchStatus.COMPLETED
                ),
                now=now,
            ),
        ),
        (
            "render",
            await _oldest_age_seconds(
                db,
                select(func.min(RenderOutbox.created_at)).where(
                    RenderOutbox.status != RenderOutboxStatus.COMPLETED
                ),
                now=now,
            ),
        ),
        (
            "playback",
            await _oldest_age_seconds(
                db,
                select(func.min(PlaybackOutbox.created_at)).where(
                    PlaybackOutbox.status != PlaybackOutboxStatus.COMPLETED
                ),
                now=now,
            ),
        ),
        (
            "mail",
            await _oldest_age_seconds(
                db,
                select(func.min(MailOutbox.created_at)).where(
                    MailOutbox.status.notin_(
                        (
                            MailOutboxStatus.SENT,
                            MailOutboxStatus.PERMANENT_FAILURE,
                            MailOutboxStatus.EXPIRED,
                        )
                    )
                ),
                now=now,
            ),
        ),
    ]
    return [
        _metric_line(
            "noteverse_async_operation_oldest_open_age_seconds",
            ("kind",),
            (kind,),
            seconds,
        )
        for kind, seconds in rows
    ]


async def _oldest_processing_age_lines(db: AsyncSession) -> list[str]:
    now = utc_now_naive()
    rows = [
        (
            "import",
            await _oldest_age_seconds(
                db,
                select(func.min(ImportJob.dispatch_started_at)).where(
                    ImportJob.dispatch_status == ImportDispatchStatus.PROCESSING
                ),
                now=now,
            ),
        ),
        (
            "render",
            await _oldest_age_seconds(
                db,
                select(func.min(RenderOutbox.started_at)).where(
                    RenderOutbox.status == RenderOutboxStatus.PROCESSING
                ),
                now=now,
            ),
        ),
        (
            "playback",
            await _oldest_age_seconds(
                db,
                select(func.min(PlaybackOutbox.started_at)).where(
                    PlaybackOutbox.status == PlaybackOutboxStatus.PROCESSING
                ),
                now=now,
            ),
        ),
        (
            "mail",
            await _oldest_age_seconds(
                db,
                select(func.min(MailOutbox.started_at)).where(
                    MailOutbox.status == MailOutboxStatus.PROCESSING
                ),
                now=now,
            ),
        ),
    ]
    return [
        _metric_line(
            "noteverse_async_operation_oldest_processing_age_seconds",
            ("kind",),
            (kind,),
            seconds,
        )
        for kind, seconds in rows
    ]


async def _completed_duration_average_lines(db: AsyncSession) -> list[str]:
    cutoff = utc_now_naive() - timedelta(hours=24)
    rows = [
        (
            "import",
            await _average_duration_seconds(
                db,
                select(
                    func.avg(
                        _duration_seconds(
                            ImportJob.dispatch_started_at,
                            ImportJob.dispatch_completed_at,
                        )
                    )
                ).where(
                    ImportJob.dispatch_status == ImportDispatchStatus.COMPLETED,
                    ImportJob.dispatch_started_at.is_not(None),
                    ImportJob.dispatch_completed_at.is_not(None),
                    ImportJob.dispatch_completed_at >= cutoff,
                ),
            ),
        ),
        (
            "render",
            await _average_duration_seconds(
                db,
                select(
                    func.avg(_duration_seconds(RenderOutbox.started_at, RenderOutbox.completed_at))
                ).where(
                    RenderOutbox.status == RenderOutboxStatus.COMPLETED,
                    RenderOutbox.started_at.is_not(None),
                    RenderOutbox.completed_at.is_not(None),
                    RenderOutbox.completed_at >= cutoff,
                ),
            ),
        ),
        (
            "playback",
            await _average_duration_seconds(
                db,
                select(
                    func.avg(
                        _duration_seconds(PlaybackOutbox.started_at, PlaybackOutbox.completed_at)
                    )
                ).where(
                    PlaybackOutbox.status == PlaybackOutboxStatus.COMPLETED,
                    PlaybackOutbox.started_at.is_not(None),
                    PlaybackOutbox.completed_at.is_not(None),
                    PlaybackOutbox.completed_at >= cutoff,
                ),
            ),
        ),
        (
            "mail",
            await _average_duration_seconds(
                db,
                select(
                    func.avg(_duration_seconds(MailOutbox.started_at, MailOutbox.completed_at))
                ).where(
                    MailOutbox.status == MailOutboxStatus.SENT,
                    MailOutbox.started_at.is_not(None),
                    MailOutbox.completed_at.is_not(None),
                    MailOutbox.completed_at >= cutoff,
                ),
            ),
        ),
    ]
    return [
        _metric_line(
            "noteverse_async_operation_completed_duration_average_seconds",
            ("kind",),
            (kind,),
            seconds,
        )
        for kind, seconds in rows
    ]


async def _scheduler_heartbeat_lines(db: AsyncSession) -> list[str]:
    result = await db.exec(select(SchedulerHeartbeat).order_by(SchedulerHeartbeat.job_key))
    lines: list[str] = []
    for heartbeat in result.scalars().all():
        # Prometheus reserves `job` for the scrape target. Keep the scheduler
        # domain dimension distinct so dashboards and alerts do not aggregate
        # by the exporting service instead of the scheduler scan.
        labels = ("scheduler_job",)
        values = (heartbeat.job_key,)
        lines.append(
            _metric_line(
                "noteverse_scheduler_last_success_timestamp_seconds",
                labels,
                values,
                scheduler_observability_service.timestamp_seconds(heartbeat.last_success_at),
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_last_failure_timestamp_seconds",
                labels,
                values,
                scheduler_observability_service.timestamp_seconds(heartbeat.last_failure_at),
            )
        )
        lines.append(
            _metric_float_line(
                "noteverse_scheduler_last_scan_duration_seconds",
                labels,
                values,
                heartbeat.last_duration_ms / 1000,
            )
        )
        lines.append(
            _metric_float_line(
                "noteverse_scheduler_scan_duration_seconds_sum",
                labels,
                values,
                heartbeat.total_duration_ms / 1000,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_scan_duration_seconds_count",
                labels,
                values,
                heartbeat.success_count + heartbeat.failure_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_last_due_records",
                labels,
                values,
                heartbeat.last_due_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_last_dispatched_records",
                labels,
                values,
                heartbeat.last_dispatched_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_successes_total",
                labels,
                values,
                heartbeat.success_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_failures_total",
                labels,
                values,
                heartbeat.failure_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_due_records_total",
                labels,
                values,
                heartbeat.total_due_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_dispatched_records_total",
                labels,
                values,
                heartbeat.total_dispatched_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_lock_acquired_total",
                labels,
                values,
                heartbeat.lock_acquired_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_lock_skipped_total",
                labels,
                values,
                heartbeat.lock_skipped_count,
            )
        )
        lines.append(
            _metric_line(
                "noteverse_scheduler_last_lock_skipped_timestamp_seconds",
                labels,
                values,
                scheduler_observability_service.timestamp_seconds(heartbeat.last_lock_skipped_at),
            )
        )
    return lines


async def _scheduler_leader_lines(db: AsyncSession) -> list[str]:
    status = await db.get(SchedulerLeaderStatus, BEAT_LEADER_SCHEDULER_NAME)
    if status is None:
        return [
            _metric_line("noteverse_scheduler_leader_last_heartbeat_timestamp_seconds", (), (), 0),
            _metric_line("noteverse_scheduler_leader_active", (), (), 0),
            _metric_line("noteverse_scheduler_leader_acquisitions_total", (), (), 0),
            _metric_line("noteverse_scheduler_leader_standby_total", (), (), 0),
            _metric_line("noteverse_scheduler_leader_child_exits_total", (), (), 0),
        ]

    heartbeat_timestamp = scheduler_observability_service.timestamp_seconds(
        status.last_heartbeat_at
    )
    active = int(
        heartbeat_timestamp > 0
        and utc_now_naive().timestamp() - heartbeat_timestamp
        <= settings.SCHEDULER_LEADER_HEARTBEAT_INTERVAL_SECONDS * 2
    )
    return [
        _metric_line(
            "noteverse_scheduler_leader_last_heartbeat_timestamp_seconds",
            (),
            (),
            heartbeat_timestamp,
        ),
        _metric_line("noteverse_scheduler_leader_active", (), (), active),
        _metric_line(
            "noteverse_scheduler_leader_acquisitions_total", (), (), status.acquired_count
        ),
        _metric_line("noteverse_scheduler_leader_standby_total", (), (), status.standby_count),
        _metric_line(
            "noteverse_scheduler_leader_child_exits_total", (), (), status.child_exit_count
        ),
    ]


async def _scheduler_lag_lines(db: AsyncSession) -> list[str]:
    now = utc_now_naive()
    rows = [
        (
            "import",
            await _oldest_age_seconds(
                db,
                select(func.min(ImportJob.next_dispatch_at)).where(
                    ImportJob.state == ImportJobState.PENDING,
                    ImportJob.dispatch_status.in_(
                        (ImportDispatchStatus.PENDING, ImportDispatchStatus.FAILED)
                    ),
                    ImportJob.next_dispatch_at <= now,
                    ImportJob.dispatch_attempt_count < settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
                ),
                now=now,
            ),
        ),
        (
            "render",
            await _oldest_age_seconds(
                db,
                select(func.min(RenderOutbox.next_attempt_at)).where(
                    RenderOutbox.status.in_(
                        (RenderOutboxStatus.PENDING, RenderOutboxStatus.FAILED)
                    ),
                    RenderOutbox.next_attempt_at <= now,
                    RenderOutbox.attempt_count < settings.RENDER_OUTBOX_MAX_ATTEMPTS,
                ),
                now=now,
            ),
        ),
        (
            "playback",
            await _oldest_age_seconds(
                db,
                select(func.min(PlaybackOutbox.next_attempt_at)).where(
                    PlaybackOutbox.status.in_(
                        (PlaybackOutboxStatus.PENDING, PlaybackOutboxStatus.FAILED)
                    ),
                    PlaybackOutbox.next_attempt_at <= now,
                    PlaybackOutbox.attempt_count < settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
                ),
                now=now,
            ),
        ),
        (
            "mail",
            await _oldest_age_seconds(
                db,
                select(func.min(MailOutbox.next_attempt_at)).where(
                    MailOutbox.status.in_((MailOutboxStatus.PENDING, MailOutboxStatus.FAILED)),
                    MailOutbox.next_attempt_at <= now,
                    MailOutbox.attempt_count < settings.MAIL_OUTBOX_MAX_ATTEMPTS,
                    or_(MailOutbox.expires_at.is_(None), MailOutbox.expires_at > now),
                ),
                now=now,
            ),
        ),
    ]
    return [
        _metric_line(
            "noteverse_scheduler_lag_seconds",
            ("kind",),
            (kind,),
            seconds,
        )
        for kind, seconds in rows
    ]


async def _oldest_age_seconds(
    db: AsyncSession,
    statement: Select[tuple[object]],
    *,
    now,
) -> int:
    result = await db.exec(statement)
    row = result.one_or_none()
    oldest = row[0] if row is not None else None
    if oldest is None:
        return 0
    return max(0, int((now - oldest).total_seconds()))


async def _average_duration_seconds(
    db: AsyncSession,
    statement: Select[tuple[object]],
) -> int:
    result = await db.exec(statement)
    row = result.one_or_none()
    average = row[0] if row is not None else None
    if average is None:
        return 0
    return max(0, int(float(average)))


def _duration_seconds(start_column, end_column):
    if settings.DATABASE_URL.startswith("sqlite"):
        return (func.julianday(end_column) - func.julianday(start_column)) * 86400
    return func.extract("epoch", end_column - start_column)
