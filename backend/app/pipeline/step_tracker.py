"""
Unified database-backed step tracking for worker jobs.

Usage pattern inside a task:
    from app.db.worker_session import get_worker_db
    from app.modules.import_jobs.worker_service import sync_import_job_service

    def _upsert(name, **kw):
        with get_worker_db() as db:
            sync_import_job_service.upsert_step(db, job_id, name=name, **kw)

    # order_map is generated dynamically by Pipeline.build_order_map().
    tracker = StepTracker(job_id, _upsert, order_map)
    tracker.on_progress("ocr")
    ...
    tracker.complete_last(final_step_name="ocr_completed")

The tracker is intentionally stateless and independent of Flask or FastAPI.
The caller supplies the `_upsert` function, including database session handling.
"""

from __future__ import annotations

from typing import Callable, Dict, Optional, Set

from app.core.logger import logger
from app.utils.timezone import utc_now_naive


class StepTracker:
    """Track processing step progress and persist it to the database."""

    def __init__(
        self,
        job_id: str,
        upsert_fn: Callable[..., None],
        order_map: Dict[str, int],
    ) -> None:
        """
        Initialize the step tracker.

        Args:
            job_id: Job UUID.
            upsert_fn: Function that upserts a step row into the database.
            order_map: Mapping of step names to display order.
        """
        self.job_id = job_id
        self._upsert = upsert_fn
        self.order_map = order_map
        self.seen: Set[str] = set()
        self.last_step: Optional[str] = None

    def on_progress(self, step: Optional[str]) -> None:
        """
        Update step progress in the database.

        Args:
            step: Current step name.
        """
        if not step:
            return

        if self.last_step is None and step != "initialization" and "initialization" in self.order_map:
            try:
                init_order = self.order_map["initialization"] if "initialization" in self.order_map else None
                self._upsert(
                    "initialization",
                    status="completed",
                    end_time=utc_now_naive(),
                    step_order=init_order,
                )
            except Exception as exc:
                logger.bind(
                    event="import_pipeline.tracker_initialization_complete_failed",
                    job_id=self.job_id,
                    step="initialization",
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).debug("Failed to complete initialization step")

        if self.last_step and self.last_step != step:
            try:
                self._upsert(
                    self.last_step,
                    status="completed",
                    end_time=utc_now_naive(),
                )
            except Exception as exc:
                logger.bind(
                    event="import_pipeline.tracker_previous_step_complete_failed",
                    job_id=self.job_id,
                    step=self.last_step,
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).debug("Failed to complete previous step")

        try:
            if step not in self.seen:
                self.seen.add(step)
                step_order = self.order_map[step] if step in self.order_map else None
                self._upsert(
                    step,
                    status="running",
                    start_time=utc_now_naive(),
                    step_order=step_order,
                )
            else:
                self._upsert(step, status="running")
        except Exception as exc:
            logger.bind(
                event="import_pipeline.tracker_step_running_failed",
                job_id=self.job_id,
                step=step,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).debug("Failed to mark step as running")

        self.last_step = step

    def complete_last(self, final_step_name: Optional[str] = None) -> None:
        """
        Complete the last running step and optionally add a final synthetic step.

        Args:
            final_step_name: Optional name for the final completion step.
        """
        now = utc_now_naive()

        if self.last_step:
            try:
                self._upsert(
                    self.last_step,
                    status="completed",
                    end_time=now,
                )
            except Exception as exc:
                logger.bind(
                    event="import_pipeline.tracker_last_step_complete_failed",
                    job_id=self.job_id,
                    step=self.last_step,
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).debug("Failed to complete last step")

        if final_step_name:
            try:
                self._upsert(
                    final_step_name,
                    status="completed",
                    start_time=now,
                    end_time=now,
                    step_order=self.order_map.get(final_step_name),
                )
            except Exception as exc:
                logger.bind(
                    event="import_pipeline.tracker_final_step_create_failed",
                    job_id=self.job_id,
                    step=final_step_name,
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).debug("Failed to create final step")

    def mark_failed(self, step_name: Optional[str]) -> None:
        """
        Mark a step as failed.

        Args:
            step_name: Name of the failed step, or `None` to mark
                initialization as failed.
        """
        try:
            if step_name:
                self._upsert(
                    step_name,
                    status="failed",
                    end_time=utc_now_naive(),
                )
            else:
                if "initialization" in self.order_map:
                    self._upsert(
                        "initialization",
                        status="failed",
                        end_time=utc_now_naive(),
                        step_order=self.order_map.get("initialization"),
                    )
        except Exception as exc:
            failed_step = step_name or "initialization"
            logger.bind(
                event="import_pipeline.tracker_step_failed_mark_failed",
                job_id=self.job_id,
                step=failed_step,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).debug("Failed to mark step as failed")
