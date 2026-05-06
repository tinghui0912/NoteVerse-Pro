from fastapi import Depends

from app.db.models import Task
from app.modules.files.service import FilesService
from app.modules.tasks.dependencies import get_task_with_view_access


def get_files_service() -> FilesService:
    """Provide the files module service."""
    return FilesService()


async def get_file_task_with_view_access(
    task: Task = Depends(get_task_with_view_access),
) -> Task:
    """Provide file-route access through a files module dependency boundary."""
    return task
