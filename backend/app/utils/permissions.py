"""Permission helpers for task view and edit access."""

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.share import SavedShare, Share
from app.db.models.task import Task
from app.db.models.user import User
from app.utils.timezone import utc_now_naive

share_task_id_col = Share.__table__.c.task_id
share_can_edit_col = Share.__table__.c.can_edit
share_expires_at_col = Share.__table__.c.expires_at
share_revoked_at_col = Share.__table__.c.revoked_at
task_id_col = Task.__table__.c.id
task_uuid_col = Task.__table__.c.task_uuid


async def check_task_view_access(
    db: AsyncSession,
    task: Task,
    current_user: User,
    share_token: str | None = None,
) -> bool:
    """Return whether the user can view the given task.

    Access is granted when the user:

    - owns the task
    - presents a valid share token for the task
    - has a valid saved share pointing to the task
    """

    if task.user_id == current_user.id:
        return True

    if share_token:
        result = await db.execute(
            select(Share).where(
                Share.token == share_token,
                Share.task_id == task.id,
                share_revoked_at_col.is_(None),
                or_(
                    share_expires_at_col.is_(None),
                    Share.expires_at > utc_now_naive(),
                ),
            )
        )
        if result.scalar_one_or_none():
            return True

    result = await db.execute(
        select(SavedShare)
        .join(Share, SavedShare.share_id == Share.id)
        .where(
            Share.task_id == task.id,
            SavedShare.user_id == current_user.id,
            share_revoked_at_col.is_(None),
            or_(
                share_expires_at_col.is_(None),
                Share.expires_at > utc_now_naive(),
            ),
        )
    )
    return result.scalar_one_or_none() is not None


async def check_task_edit_access(
    db: AsyncSession,
    task: Task,
    current_user: User,
    share_token: str | None = None,
) -> bool:
    """Return whether the user can edit the given task.

    Access is granted when the user:

    - owns the task
    - presents a valid editable share token
    - has a valid saved share that grants edit access
    """

    if task.user_id == current_user.id:
        return True

    if share_token:
        result = await db.execute(
            select(Share).where(
                Share.token == share_token,
                Share.task_id == task.id,
                share_can_edit_col.is_(True),
                share_revoked_at_col.is_(None),
                or_(
                    share_expires_at_col.is_(None),
                    Share.expires_at > utc_now_naive(),
                ),
            )
        )
        if result.scalar_one_or_none():
            return True

    result = await db.execute(
        select(SavedShare)
        .join(Share, SavedShare.share_id == Share.id)
        .where(
            Share.task_id == task.id,
            SavedShare.user_id == current_user.id,
            share_can_edit_col.is_(True),
            share_revoked_at_col.is_(None),
            or_(
                share_expires_at_col.is_(None),
                Share.expires_at > utc_now_naive(),
            ),
        )
    )
    return result.scalar_one_or_none() is not None


async def get_accessible_tasks(
    db: AsyncSession,
    user: User,
    requested_task_uuids: list[str],
) -> list[Task]:
    """Return the requested tasks that the user is allowed to access."""

    saved_result = await db.execute(
        select(Share.task_id)
        .join(SavedShare, SavedShare.share_id == Share.id)
        .where(
            SavedShare.user_id == user.id,
            share_revoked_at_col.is_(None),
            or_(
                share_expires_at_col.is_(None),
                Share.expires_at > utc_now_naive(),
            ),
        )
    )
    saved_task_ids = [row[0] for row in saved_result.all()]

    result = await db.execute(
        select(Task).where(
            task_uuid_col.in_(requested_task_uuids),
            or_(
                Task.user_id == user.id,
                task_id_col.in_(saved_task_ids) if saved_task_ids else False,
            ),
        )
    )
    return list(result.scalars().all())
