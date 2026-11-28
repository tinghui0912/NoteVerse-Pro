"""Take media task wiring and durable dispatch recovery."""

from app.runtime.worker.main import celery_app
from app.worker.task_runtime import run_scheduler_scan
from app.runtime.worker.context import get_context


def execute_take_processing(operation_uuid: str) -> dict[str, str]:
    return {
        "status": get_context().resources.build_take_processing_service().execute(operation_uuid)
    }


def execute_take_processing_maintenance() -> dict[str, int]:
    def scan():
        service = get_context().resources.build_take_processing_service()
        due, dispatched = service.due(), 0
        for uuid in due:
            try:
                celery_app.send_task("app.worker.tasks.take_media_processing_task", args=[uuid])
                dispatched += 1
            except Exception:
                service.release_dispatch(uuid)
        return {"due": len(due), "dispatched": dispatched}

    return run_scheduler_scan("take_media_processing", scan)
