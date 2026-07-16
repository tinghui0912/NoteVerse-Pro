"""Prometheus metrics derived from async operation tables."""

from __future__ import annotations

from collections.abc import Iterable

from datetime import timedelta

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import (
    ImportDispatchStatus,
    ImportJob,
    MailOutbox,
    MailOutboxStatus,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    RenderOutbox,
    RenderOutboxStatus,
    Score,
)
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
    value: int,
) -> str:
    labels = ",".join(
        f'{name}="{_escape_label_value(label_value)}"'
        for name, label_value in zip(label_names, label_values, strict=True)
    )
    return f"{metric_name}{{{labels}}} {value}"


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
