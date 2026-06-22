"""Canonical router for the tasks module."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.models import Task, User
from app.db.model_utils import require_persisted_id
from app.modules.tasks.dependencies import get_task_service, get_task_with_view_access
from app.modules.tasks.schemas import (
    BatchArchiveRequest,
    BatchDeleteTasksRequest,
    TaskUpdateRequest,
)
from app.modules.tasks.service import TaskService
from app.shared.constants import SuccessCode
from app.shared.responses import paginated_response, success_response

router = APIRouter()


@router.get("")
async def list_user_tasks(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    state: Optional[str] = Query(None, description="Filter by state"),
    sort_by: str = Query("created_at", description="Sort field: created_at, title"),
    sort_order: str = Query("desc", description="Sort order: asc, desc"),
    search: Optional[str] = Query(None, description="Search by title"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_service: TaskService = Depends(get_task_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await task_service.list_tasks(
        db,
        user_id,
        page=page,
        page_size=page_size,
        state=state,
        sort_by=sort_by,
        sort_order=sort_order,
        search=search,
    )

    return paginated_response(
        data=result["tasks"],
        page=page,
        page_size=page_size,
        total=result["total"],
    )


@router.get("/{task_id}/details")
async def get_task_details(
    task: Task = Depends(get_task_with_view_access),
    task_service: TaskService = Depends(get_task_service),
):
    status_data = await task_service.get_task_details(task.task_uuid)
    return success_response(data=status_data)


@router.patch("/{task_id}")
async def update_task_info(
    task_id: str,
    request: TaskUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_service: TaskService = Depends(get_task_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await task_service.update_task(
        db,
        task_id,
        user_id,
        title=request.title,
        difficulty=request.difficulty,
    )

    return success_response(
        data=result,
        message=SuccessCode.UPDATE_SUCCESS,
    )


@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_service: TaskService = Depends(get_task_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await task_service.delete_task(db, task_id, user_id)
    return success_response(message=SuccessCode.DELETE_SUCCESS)


@router.post("/batch-delete")
async def batch_delete_tasks(
    request: BatchDeleteTasksRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_service: TaskService = Depends(get_task_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await task_service.batch_delete(db, request.task_ids, user_id)

    return success_response(
        data=result,
        message=SuccessCode.TASKS_DELETED,
    )


@router.post("/archive")
async def batch_archive(
    request: BatchArchiveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    task_service: TaskService = Depends(get_task_service),
):
    archive_stream, filename, downloaded_count, skipped_count = await task_service.build_archive(
        db,
        current_user,
        request,
    )

    return StreamingResponse(
        archive_stream,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Downloaded-Count": str(downloaded_count),
            "X-Skipped-Count": str(skipped_count),
            "Access-Control-Expose-Headers": "X-Downloaded-Count, X-Skipped-Count",
        },
    )


__all__ = ["router"]
