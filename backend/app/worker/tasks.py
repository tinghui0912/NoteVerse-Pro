"""Celery task entrypoints for NoteVerse background work."""

from app.modules.import_jobs.schemas import PipelineExecutionSuccessResult
from app.pipeline.context import CeleryTaskLike
from app.worker.celery_config import celery_app
from app.worker.execution.import_job import execute_import_job_task
from app.worker.execution.mail_outbox import execute_mail_outbox_task
from app.worker.execution.maintenance_cleanup import (
    execute_derived_asset_cleanup,
    execute_job_maintenance,
    execute_mail_outbox_cleanup,
    execute_notification_maintenance,
    execute_realtime_maintenance,
    execute_score_deletion_cleanup,
)
from app.worker.execution.maintenance_dispatch import (
    execute_import_dispatch_maintenance,
    execute_mail_outbox_maintenance,
    execute_playback_outbox_maintenance,
    execute_practice_replay_object_deletion_maintenance,
    execute_render_outbox_maintenance,
)
from app.worker.execution.playback_outbox import execute_playback_outbox_task
from app.worker.execution.practice_replay_object_deletion import (
    execute_practice_replay_object_deletion_task,
)
from app.worker.execution.render_outbox import execute_render_outbox_task


@celery_app.task(
    bind=True,
    name="app.worker.tasks.process_images_job",
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_images_job(
    self: CeleryTaskLike,
    job_uuid: str,
) -> PipelineExecutionSuccessResult:
    """Run the score import pipeline for one or more input images."""
    return execute_import_job_task(self, job_uuid)


@celery_app.task(name="app.worker.tasks.send_mail_outbox_task", bind=True, ignore_result=True)
def send_mail_outbox_task(self: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    """Deliver one persistent transactional-mail record."""
    return execute_mail_outbox_task(self, outbox_uuid)


@celery_app.task(name="app.worker.tasks.render_outbox_task", bind=True, ignore_result=True)
def render_outbox_task(self: CeleryTaskLike, outbox_uuid: str) -> dict[str, str | None]:
    """Render one durable score-revision or review-thumbnail target."""
    return execute_render_outbox_task(self, outbox_uuid)


@celery_app.task(name="app.worker.tasks.playback_outbox_task", bind=True, ignore_result=True)
def playback_outbox_task(self: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    """Generate one durable score playback asset."""
    return execute_playback_outbox_task(self, outbox_uuid)


@celery_app.task(
    name="app.worker.tasks.practice_replay_object_deletion_task",
    bind=True,
    ignore_result=True,
)
def practice_replay_object_deletion_task(
    self: CeleryTaskLike,
    outbox_uuid: str,
) -> dict[str, str]:
    """Delete one saved practice replay object from storage."""
    return execute_practice_replay_object_deletion_task(self, outbox_uuid)


@celery_app.task(name="app.worker.tasks.run_job_maintenance")
def run_job_maintenance() -> dict[str, int]:
    """Run periodic import-job/upload maintenance."""
    return execute_job_maintenance()


@celery_app.task(name="app.worker.tasks.run_import_dispatch_maintenance")
def run_import_dispatch_maintenance() -> dict[str, int]:
    """Recover stale import deliveries and dispatch all due jobs."""
    return execute_import_dispatch_maintenance()


@celery_app.task(name="app.worker.tasks.run_notification_maintenance")
def run_notification_maintenance() -> dict[str, int]:
    """Run periodic user-notification cleanup."""
    return execute_notification_maintenance()


@celery_app.task(name="app.worker.tasks.run_realtime_maintenance")
def run_realtime_maintenance() -> dict[str, int]:
    """Run periodic realtime-event cleanup."""
    return execute_realtime_maintenance()


@celery_app.task(name="app.worker.tasks.run_derived_asset_cleanup")
def run_derived_asset_cleanup() -> dict[str, int]:
    """Remove derived preview/audio assets outside the retention window."""
    return execute_derived_asset_cleanup()


@celery_app.task(name="app.worker.tasks.run_score_deletion_cleanup")
def run_score_deletion_cleanup() -> dict[str, int]:
    """Hard-delete scores that were hidden by a user deletion request."""
    return execute_score_deletion_cleanup()


@celery_app.task(name="app.worker.tasks.run_render_outbox_maintenance")
def run_render_outbox_maintenance() -> dict[str, int]:
    """Recover stale render deliveries and dispatch all due outbox records."""
    return execute_render_outbox_maintenance()


@celery_app.task(name="app.worker.tasks.run_playback_outbox_maintenance")
def run_playback_outbox_maintenance() -> dict[str, int]:
    """Recover stale playback deliveries and dispatch all due outbox records."""
    return execute_playback_outbox_maintenance()


@celery_app.task(name="app.worker.tasks.run_practice_replay_object_deletion_maintenance")
def run_practice_replay_object_deletion_maintenance() -> dict[str, int]:
    """Recover, dispatch, and retry saved practice replay object deletions."""
    return execute_practice_replay_object_deletion_maintenance()


@celery_app.task(name="app.worker.tasks.run_mail_outbox_maintenance")
def run_mail_outbox_maintenance() -> dict[str, int]:
    """Recover, dispatch, and expire durable mail records."""
    return execute_mail_outbox_maintenance()


@celery_app.task(name="app.worker.tasks.run_mail_outbox_cleanup")
def run_mail_outbox_cleanup() -> dict[str, int]:
    """Delete terminal mail records after their retention window."""
    return execute_mail_outbox_cleanup()
