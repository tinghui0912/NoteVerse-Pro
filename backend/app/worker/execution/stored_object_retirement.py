"""Worker execution boundary for durable physical retirement."""

from app.modules.media_storage.retirement_execution import execute_retirement
from app.worker.task_runtime import bind_task_context, clear_task_context
from app.runtime.worker.context import get_context


def execute_stored_object_retirement_task(task, retirement_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    try:
        return execute_retirement(
            retirement_uuid,
            get_context().sessions,
            get_context().storage,
            get_context().deliveries.retirement,
        )
    finally:
        clear_task_context()
