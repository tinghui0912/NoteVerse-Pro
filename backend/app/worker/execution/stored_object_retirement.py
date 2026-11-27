"""Worker execution boundary for durable physical retirement."""

from app.db.session import SessionLocal
from app.storage import object_storage
from app.modules.media_storage.retirement_execution import execute_retirement
from app.worker.task_runtime import bind_task_context, clear_task_context


def execute_stored_object_retirement_task(task, retirement_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    try:
        return execute_retirement(retirement_uuid, SessionLocal, object_storage)
    finally:
        clear_task_context()
