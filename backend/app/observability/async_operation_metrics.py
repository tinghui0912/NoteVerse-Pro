"""Prometheus metrics derived from async operation tables."""

from __future__ import annotations

from collections.abc import Iterable

from datetime import timedelta

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    ImportJob,
    MailOutbox,
    PlaybackOutbox,
    ScoreRevisionRenderOutbox,
    SchedulerHeartbeat,
    SchedulerLeaderStatus,
    ScoreDeletionOperation,
    ObjectWriteIntent,
    UploadSession,
    TakeProcessingOutbox,
)
from app.modules.ops.operation_projection import operation_projection
from app.modules.ops.schemas import AsyncOperationKind
from app.modules.scheduler_lock.constants import BEAT_LEADER_SCHEDULER_NAME
from app.modules.scheduler_observability.service import scheduler_observability_service
from app.shared.time import utc_now


def async_operation_metrics_text(db: Session) -> str:
    """Return current async operation state metrics in Prometheus text format."""

    lines = [
        "# HELP noteverse_import_jobs_by_state Import jobs grouped by current business state.",
        "# TYPE noteverse_import_jobs_by_state gauge",
        *_enum_count_lines(
            db,
            statement=select(ImportJob.state, func.count()).group_by(ImportJob.state),
            metric_name="noteverse_import_jobs_by_state",
            label_names=("state",),
        ),
        "# HELP noteverse_outbox_records_by_status Outbox records grouped by kind and status.",
        "# TYPE noteverse_outbox_records_by_status gauge",
        *_enum_count_lines(
            db,
            statement=select(ScoreRevisionRenderOutbox.status, func.count()).group_by(
                ScoreRevisionRenderOutbox.status
            ),
            metric_name="noteverse_outbox_records_by_status",
            label_names=("kind", "status"),
            fixed_labels=("revision_render",),
        ),
        *_enum_count_lines(
            db,
            statement=select(PlaybackOutbox.status, func.count()).group_by(PlaybackOutbox.status),
            metric_name="noteverse_outbox_records_by_status",
            label_names=("kind", "status"),
            fixed_labels=("playback",),
        ),
        *_enum_count_lines(
            db,
            statement=select(MailOutbox.status, func.count()).group_by(MailOutbox.status),
            metric_name="noteverse_outbox_records_by_status",
            label_names=("kind", "status"),
            fixed_labels=("mail",),
        ),
        "# HELP noteverse_score_deletions_by_status Score deletion cleanup records grouped by status.",
        "# TYPE noteverse_score_deletions_by_status gauge",
        *_enum_count_lines(
            db,
            statement=select(ScoreDeletionOperation.status, func.count()).group_by(
                ScoreDeletionOperation.status
            ),
            metric_name="noteverse_score_deletions_by_status",
            label_names=("status",),
        ),
        "# HELP noteverse_async_operation_oldest_open_age_seconds Oldest non-terminal async operation age in seconds.",
        "# TYPE noteverse_async_operation_oldest_open_age_seconds gauge",
        *_oldest_open_age_lines(db),
        "# HELP noteverse_async_operation_oldest_unfinished_age_seconds Oldest unfinished operation including stopped failures.",
        "# TYPE noteverse_async_operation_oldest_unfinished_age_seconds gauge",
        *_projected_age_lines(
            db,
            statuses=("queued", "dispatched", "processing", "retrying", "failed"),
            column="created_at",
            metric="noteverse_async_operation_oldest_unfinished_age_seconds",
        ),
        "# HELP noteverse_async_operations_by_status Durable operations by unified kind and status.",
        "# TYPE noteverse_async_operations_by_status gauge",
        *_projected_status_lines(db),
        "# HELP noteverse_async_operation_oldest_processing_age_seconds Oldest currently processing async operation age in seconds.",
        "# TYPE noteverse_async_operation_oldest_processing_age_seconds gauge",
        *_oldest_processing_age_lines(db),
        "# HELP noteverse_async_operation_completed_duration_average_seconds Average completed async operation duration in seconds over the last 24 hours.",
        "# TYPE noteverse_async_operation_completed_duration_average_seconds gauge",
        *_completed_duration_average_lines(db),
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
        *_scheduler_heartbeat_lines(db),
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
        *_scheduler_leader_lines(db),
        "# HELP noteverse_scheduler_lag_seconds Oldest due record delay before scheduler dispatch by async operation kind.",
        "# TYPE noteverse_scheduler_lag_seconds gauge",
        *_scheduler_lag_lines(db),
        *_media_resource_lines(db),
    ]
    return "\n".join(lines) + "\n"


def _enum_count_lines(
    db: Session,
    *,
    statement: Select[tuple[object, int]],
    metric_name: str,
    label_names: tuple[str, ...],
    fixed_labels: tuple[str, ...] = (),
) -> list[str]:
    result = db.execute(statement)
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


def _oldest_open_age_lines(db: Session) -> list[str]:
    return _projected_age_lines(
        db,
        statuses=("queued", "dispatched", "processing", "retrying"),
        column="created_at",
        metric="noteverse_async_operation_oldest_open_age_seconds",
    )


def _oldest_processing_age_lines(db: Session) -> list[str]:
    return _projected_age_lines(
        db,
        statuses=("processing",),
        column="started_at",
        metric="noteverse_async_operation_oldest_processing_age_seconds",
    )


def _projected_age_lines(
    db: Session, *, statuses: tuple[str, ...], column: str, metric: str
) -> list[str]:
    c = operation_projection().c
    rows = dict(
        db.execute(
            select(c.kind, func.min(c[column])).where(c.status.in_(statuses)).group_by(c.kind)
        ).all()
    )
    now = utc_now()
    return [
        _metric_line(
            metric,
            ("kind",),
            (kind.value,),
            max(0, int((now - rows[kind.value]).total_seconds()))
            if rows.get(kind.value) is not None
            else 0,
        )
        for kind in AsyncOperationKind
    ]


def _completed_duration_average_lines(db: Session) -> list[str]:
    c = operation_projection().c
    start = case(
        (c.kind.in_(("account_deletion", "stored_object_retirement")), c.created_at),
        else_=c.started_at,
    )
    rows = dict(
        db.execute(
            select(c.kind, func.avg(_duration_seconds(start, c.completed_at)))
            .where(
                c.status == "succeeded",
                start.is_not(None),
                c.completed_at.is_not(None),
                c.completed_at >= utc_now() - timedelta(hours=24),
            )
            .group_by(c.kind)
        ).all()
    )
    return [
        _metric_line(
            "noteverse_async_operation_completed_duration_average_seconds",
            ("kind",),
            (kind.value,),
            max(0, int(float(rows.get(kind.value) or 0))),
        )
        for kind in AsyncOperationKind
    ]


def _scheduler_heartbeat_lines(db: Session) -> list[str]:
    result = db.execute(select(SchedulerHeartbeat).order_by(SchedulerHeartbeat.job_key))
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


def _scheduler_leader_lines(db: Session) -> list[str]:
    status = db.get(SchedulerLeaderStatus, BEAT_LEADER_SCHEDULER_NAME)
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
        and utc_now().timestamp() - heartbeat_timestamp
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


def _projected_status_lines(db: Session) -> list[str]:
    c = operation_projection().c
    rows = db.execute(select(c.kind, c.status, func.count()).group_by(c.kind, c.status)).all()
    from app.modules.ops.schemas import AsyncOperationStatus

    counts = {(kind, status): count for kind, status, count in rows}
    return [
        _metric_line(
            "noteverse_async_operations_by_status",
            ("kind", "status"),
            (kind.value, status.value),
            counts.get((kind.value, status.value), 0),
        )
        for kind in AsyncOperationKind
        for status in AsyncOperationStatus
    ]


def _scheduler_lag_lines(db: Session) -> list[str]:
    c = operation_projection().c
    now = utc_now()
    rows = dict(
        db.execute(
            select(c.kind, func.min(c.next_attempt_at))
            .where(
                c.status.in_(("queued", "retrying")),
                c.next_attempt_at <= now,
                c.attempts < c.max_attempts,
                c.failure_retryable.is_not(False),
            )
            .group_by(c.kind)
        ).all()
    )
    return [
        _metric_line(
            "noteverse_scheduler_lag_seconds",
            ("kind",),
            (kind.value,),
            max(0, int((now - rows[kind.value]).total_seconds())) if kind.value in rows else 0,
        )
        for kind in AsyncOperationKind
    ]


def _duration_seconds(start_column, end_column):
    if settings.DATABASE_URL.startswith("sqlite"):
        return (func.julianday(end_column) - func.julianday(start_column)) * 86400
    return func.extract("epoch", end_column - start_column)


def _media_resource_lines(db: Session) -> list[str]:
    """Aggregate physical responsibility without exporting identities or locators."""
    from app.modules.media_storage.domain import ObjectWriteIntentStatus as Write
    from app.modules.media_storage.upload_sessions.domain import ACTIVE_STATUSES
    from app.modules.performance_takes.processing_states import TakeProcessingStatus as Take

    now = utc_now()
    populations = (
        (
            "write_unknown",
            ObjectWriteIntent.created_at,
            ObjectWriteIntent.status == Write.WRITE_UNKNOWN,
        ),
        ("upload_unknown", UploadSession.created_at, UploadSession.operation_unknown.is_(True)),
        (
            "upload_expired_uncleaned",
            UploadSession.created_at,
            (UploadSession.expires_at <= now)
            & UploadSession.cleanup_completed_at.is_(None)
            & ~((UploadSession.mode == "MULTIPART") & (UploadSession.status == "CONSUMED")),
        ),
        (
            "take_processing_failed",
            TakeProcessingOutbox.created_at,
            TakeProcessingOutbox.status == Take.FAILED,
        ),
        (
            "take_processing_pending",
            TakeProcessingOutbox.created_at,
            TakeProcessingOutbox.status.in_((Take.PENDING, Take.DISPATCHED, Take.PROCESSING)),
        ),
        (
            "take_processing_lease_expired",
            TakeProcessingOutbox.created_at,
            (TakeProcessingOutbox.status == Take.PROCESSING)
            & (
                TakeProcessingOutbox.started_at
                <= now - timedelta(seconds=settings.TAKE_PROCESSING_LEASE_SECONDS)
            ),
        ),
        ("upload_active", UploadSession.created_at, UploadSession.status.in_(ACTIVE_STATUSES)),
    )
    lines = [
        "# HELP noteverse_media_resource_backlog Current physical responsibility and media work.",
        "# TYPE noteverse_media_resource_backlog gauge",
        "# HELP noteverse_media_resource_oldest_age_seconds Oldest outstanding media responsibility.",
        "# TYPE noteverse_media_resource_oldest_age_seconds gauge",
    ]
    for kind, created_at, predicate in populations:
        count, oldest = db.execute(
            select(func.count(), func.min(created_at)).where(predicate)
        ).one()
        lines.append(_metric_line("noteverse_media_resource_backlog", ("kind",), (kind,), count))
        lines.append(
            _metric_line(
                "noteverse_media_resource_oldest_age_seconds",
                ("kind",),
                (kind,),
                max(0, int((now - oldest).total_seconds())) if oldest else 0,
            )
        )
    lines.extend(
        _enum_count_lines(
            db,
            statement=select(TakeProcessingOutbox.status, func.count()).group_by(
                TakeProcessingOutbox.status
            ),
            metric_name="noteverse_outbox_records_by_status",
            label_names=("kind", "status"),
            fixed_labels=("take_media_processing",),
        )
    )
    return lines
