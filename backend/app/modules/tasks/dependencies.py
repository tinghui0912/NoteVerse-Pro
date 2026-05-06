from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import Task
from app.db.models.user import User
from app.modules.tasks.service import TaskService
from app.shared.constants import ErrorCode
from app.utils.permissions import check_task_edit_access, check_task_view_access


def get_task_service() -> TaskService:
    return TaskService()


async def verify_task_ownership(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Task:
    task_result = await db.execute(select(Task).where(Task.task_uuid == task_id))
    task = task_result.scalars().first()

    if not task:
        raise ResourceNotFoundException(
            resource_type="task",
            resource_id=task_id,
            code=ErrorCode.TASK_NOT_FOUND,
        )

    if task.user_id != current_user.id:
        raise UnauthorizedException(
            code=ErrorCode.NO_ACCESS,
            details={"task_id": task_id},
        )

    return task


async def get_task_with_view_access(
    task_id: str,
    share_token: Annotated[
        str | None,
        Query(description="Optional share token used to validate task view access."),
    ] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Task:
    task_result = await db.execute(select(Task).where(Task.task_uuid == task_id))
    task = task_result.scalars().first()

    if not task:
        raise ResourceNotFoundException(
            resource_type="task",
            resource_id=task_id,
            code=ErrorCode.TASK_NOT_FOUND,
        )

    has_access = await check_task_view_access(db, task, current_user, share_token)
    if not has_access:
        raise UnauthorizedException(
            code=ErrorCode.NO_ACCESS,
            details={"task_id": task_id},
        )

    return task


async def get_task_with_edit_access(
    task_id: str,
    share_token: Annotated[
        str | None,
        Query(description="Optional share token used to validate task edit access."),
    ] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Task:
    task_result = await db.execute(select(Task).where(Task.task_uuid == task_id))
    task = task_result.scalars().first()

    if not task:
        raise ResourceNotFoundException(
            resource_type="task",
            resource_id=task_id,
            code=ErrorCode.TASK_NOT_FOUND,
        )

    has_access = await check_task_edit_access(db, task, current_user, share_token)
    if not has_access:
        raise UnauthorizedException(
            code=ErrorCode.NO_EDIT_ACCESS,
            details={"task_id": task_id},
        )

    return task
