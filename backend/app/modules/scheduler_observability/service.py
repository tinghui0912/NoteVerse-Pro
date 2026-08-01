from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import SchedulerHeartbeat
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class SchedulerRunStats:
    due: int = 0
    dispatched: int = 0


class SchedulerObservabilityService:
    def record_lock_acquired(self, db: Session, job_key: str) -> None:
        heartbeat = self._get_or_create(db, job_key)
        heartbeat.lock_acquired_count += 1
        heartbeat.updated_at = utc_now_naive()

    def record_lock_skipped(self, db: Session, job_key: str) -> None:
        heartbeat = self._get_or_create(db, job_key)
        now = utc_now_naive()
        heartbeat.lock_skipped_count += 1
        heartbeat.last_lock_skipped_at = now
        heartbeat.updated_at = now

    def record_started(self, db: Session, job_key: str) -> None:
        heartbeat = self._get_or_create(db, job_key)
        now = utc_now_naive()
        heartbeat.last_started_at = now
        heartbeat.updated_at = now

    def record_success(
        self,
        db: Session,
        job_key: str,
        *,
        duration_seconds: float,
        stats: SchedulerRunStats,
    ) -> None:
        heartbeat = self._get_or_create(db, job_key)
        now = utc_now_naive()
        duration_ms = max(0, int(duration_seconds * 1000))
        heartbeat.last_success_at = now
        heartbeat.last_duration_ms = duration_ms
        heartbeat.last_due_count = stats.due
        heartbeat.last_dispatched_count = stats.dispatched
        heartbeat.total_duration_ms += duration_ms
        heartbeat.total_due_count += stats.due
        heartbeat.total_dispatched_count += stats.dispatched
        heartbeat.success_count += 1
        heartbeat.last_error = None
        heartbeat.updated_at = now

    def record_failure(
        self,
        db: Session,
        job_key: str,
        *,
        duration_seconds: float,
        error: str,
    ) -> None:
        heartbeat = self._get_or_create(db, job_key)
        now = utc_now_naive()
        duration_ms = max(0, int(duration_seconds * 1000))
        heartbeat.last_failure_at = now
        heartbeat.last_duration_ms = duration_ms
        heartbeat.total_duration_ms += duration_ms
        heartbeat.failure_count += 1
        heartbeat.last_error = error[:4000]
        heartbeat.updated_at = now

    @staticmethod
    def timestamp_seconds(value: datetime | None) -> int:
        if value is None:
            return 0
        return int(value.timestamp())

    @staticmethod
    def _get_or_create(db: Session, job_key: str) -> SchedulerHeartbeat:
        heartbeat = db.execute(
            select(SchedulerHeartbeat).where(SchedulerHeartbeat.job_key == job_key)
        ).scalar_one_or_none()
        if heartbeat is not None:
            return heartbeat
        heartbeat = SchedulerHeartbeat(job_key=job_key)
        db.add(heartbeat)
        db.flush()
        return heartbeat


scheduler_observability_service = SchedulerObservabilityService()
