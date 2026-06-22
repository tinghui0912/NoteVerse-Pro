from collections import defaultdict
from typing import Dict, List, Optional

from sqlalchemy import asc, delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.file_kinds import FileKind
from app.db.models import Task
from app.db.models.file import File, TaskUpload
from app.db.models.share import SavedShare, Share
from app.db.models.task import TaskStep

file_task_id_col = File.__table__.c.task_id
saved_share_id_col = SavedShare.__table__.c.id
saved_share_share_id_col = SavedShare.__table__.c.share_id
share_id_col = Share.__table__.c.id
share_task_id_col = Share.__table__.c.task_id
task_id_col = Task.__table__.c.id
task_title_col = Task.__table__.c.title
task_uuid_col = Task.__table__.c.task_uuid
task_step_task_id_col = TaskStep.__table__.c.task_id
task_upload_task_id_col = TaskUpload.__table__.c.task_id


class TaskRepository:
    async def count_tasks(
        self,
        db: AsyncSession,
        user_id: int,
        state: Optional[str] = None,
        search: Optional[str] = None,
    ) -> int:
        query = select(func.count()).select_from(Task).where(Task.user_id == user_id)
        if state:
            query = query.where(Task.state == state)
        if search:
            query = query.where(task_title_col.ilike(f"%{search}%"))

        result = await db.execute(query)
        return result.scalar()

    async def list_tasks(
        self,
        db: AsyncSession,
        user_id: int,
        page: int,
        page_size: int,
        state: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        search: Optional[str] = None,
    ) -> List[Task]:
        query = select(Task).where(Task.user_id == user_id)
        if state:
            query = query.where(Task.state == state)
        if search:
            query = query.where(task_title_col.ilike(f"%{search}%"))

        sort_column = Task.title if sort_by == "title" else Task.created_at
        order_func = asc if sort_order == "asc" else desc
        query = query.order_by(order_func(sort_column))
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await db.execute(query)
        return result.scalars().all()

    async def get_thumbnail_types(
        self,
        db: AsyncSession,
        task_ids: List[int],
    ) -> Dict[int, str]:
        if not task_ids:
            return {}

        files_result = await db.execute(
            select(File.task_id, File.kind).where(
                file_task_id_col.in_(task_ids),
                File.kind.in_([FileKind.FINAL_IMAGE, FileKind.PREVIEW_IMAGE, FileKind.ORIGINAL_IMAGE]),
            )
        )
        task_files = files_result.all()

        task_file_kinds: Dict[int, set] = {}
        for task_id, kind in task_files:
            if task_id not in task_file_kinds:
                task_file_kinds[task_id] = set()
            task_file_kinds[task_id].add(kind.value if hasattr(kind, "value") else kind)

        result: Dict[int, str] = {}
        for task_id, kinds in task_file_kinds.items():
            if FileKind.FINAL_IMAGE.value in kinds:
                result[task_id] = FileKind.FINAL_IMAGE.value
            elif FileKind.PREVIEW_IMAGE.value in kinds:
                result[task_id] = FileKind.PREVIEW_IMAGE.value
            elif FileKind.ORIGINAL_IMAGE.value in kinds:
                result[task_id] = FileKind.ORIGINAL_IMAGE.value

        return result

    async def get_task_by_uuid(
        self,
        db: AsyncSession,
        task_uuid: str,
    ) -> Optional[Task]:
        result = await db.execute(select(Task).where(Task.task_uuid == task_uuid))
        return result.scalar_one_or_none()

    async def get_tasks_by_uuids_for_user(
        self,
        db: AsyncSession,
        task_uuids: List[str],
        user_id: int,
    ) -> List[Task]:
        result = await db.execute(
            select(Task).where(
                task_uuid_col.in_(task_uuids),
                Task.user_id == user_id,
            )
        )
        return result.scalars().all()

    async def get_share_ids_for_tasks(
        self,
        db: AsyncSession,
        task_db_ids: List[int],
    ) -> List[int]:
        result = await db.execute(select(Share.id).where(share_task_id_col.in_(task_db_ids)))
        return [row[0] for row in result.fetchall()]

    async def delete_task_graph(
        self,
        db: AsyncSession,
        task_db_ids: List[int],
        share_ids: Optional[List[int]] = None,
    ) -> None:
        if share_ids:
            await db.execute(delete(SavedShare).where(saved_share_share_id_col.in_(share_ids)))

        await db.execute(delete(Share).where(share_task_id_col.in_(task_db_ids)))
        await db.execute(delete(TaskStep).where(task_step_task_id_col.in_(task_db_ids)))
        await db.execute(delete(File).where(file_task_id_col.in_(task_db_ids)))
        await db.execute(delete(TaskUpload).where(task_upload_task_id_col.in_(task_db_ids)))
        await db.execute(delete(Task).where(task_id_col.in_(task_db_ids)))

    async def delete_single_task_graph(
        self,
        db: AsyncSession,
        task_id: int,
    ) -> None:
        await db.execute(delete(TaskStep).where(TaskStep.task_id == task_id))
        await db.execute(delete(File).where(File.task_id == task_id))
        await db.execute(delete(TaskUpload).where(TaskUpload.task_id == task_id))
        await db.execute(delete(Task).where(Task.id == task_id))

    async def list_files_for_tasks(
        self,
        db: AsyncSession,
        task_ids: List[int],
    ) -> Dict[int, List[File]]:
        if not task_ids:
            return {}

        result = await db.execute(select(File).where(file_task_id_col.in_(task_ids)))
        files = result.scalars().all()

        files_by_task: Dict[int, List[File]] = defaultdict(list)
        for file in files:
            files_by_task[file.task_id].append(file)

        return dict(files_by_task)


task_repository = TaskRepository()
