from sqlalchemy import delete, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db.models import Share, Task, User
from app.db.models.file import File
from app.db.models.share import SavedShare

file_task_id_col = File.__table__.c.task_id
saved_share_id_col = SavedShare.__table__.c.id
task_title_col = Task.__table__.c.title


class SharesRepository:
    """Data-access helpers for the shares module."""

    async def get_task_by_uuid(
        self,
        db: AsyncSession,
        task_uuid: str,
    ) -> Task | None:
        result = await db.exec(select(Task).where(Task.task_uuid == task_uuid))
        return result.one_or_none()

    async def get_task_by_id(
        self,
        db: AsyncSession,
        task_id: int,
    ) -> Task | None:
        result = await db.exec(select(Task).where(Task.id == task_id))
        return result.one_or_none()

    async def get_owner_by_id(
        self,
        db: AsyncSession,
        user_id: int,
    ) -> User | None:
        result = await db.exec(select(User).where(User.id == user_id))
        return result.one_or_none()

    async def get_share_by_token(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> Share | None:
        result = await db.exec(select(Share).where(Share.token == share_token))
        return result.one_or_none()

    async def count_shares_for_owner(
        self,
        db: AsyncSession,
        owner_user_id: int,
        task_db_id: int | None = None,
    ) -> int:
        query = select(func.count()).select_from(Share).where(Share.owner_user_id == owner_user_id)
        if task_db_id is not None:
            query = query.where(Share.task_id == task_db_id)
        result = await db.exec(query)
        return result.one() or 0

    async def list_shares_for_owner(
        self,
        db: AsyncSession,
        owner_user_id: int,
        page: int,
        page_size: int,
        task_db_id: int | None = None,
    ) -> list[Share]:
        query = select(Share).where(Share.owner_user_id == owner_user_id)
        if task_db_id is not None:
            query = query.where(Share.task_id == task_db_id)
        query = query.order_by(desc(Share.created_at)).offset((page - 1) * page_size).limit(page_size)
        result = await db.exec(query)
        return list(result.all())

    async def list_share_rows_for_owner(
        self,
        db: AsyncSession,
        owner_user_id: int,
        page: int,
        page_size: int,
        task_db_id: int | None = None,
    ) -> list[tuple[Share, Task]]:
        query = (
            select(Share, Task)
            .join(Task, Share.task_id == Task.id)
            .where(Share.owner_user_id == owner_user_id)
        )
        if task_db_id is not None:
            query = query.where(Share.task_id == task_db_id)
        query = query.order_by(desc(Share.created_at)).offset((page - 1) * page_size).limit(page_size)
        result = await db.exec(query)
        return list(result.all())

    async def delete_share_by_id(
        self,
        db: AsyncSession,
        share_id: int,
    ) -> None:
        await db.execute(delete(Share).where(Share.id == share_id))

    async def count_saved_shares(
        self,
        db: AsyncSession,
        user_id: int,
        search: str | None = None,
    ) -> int:
        query = (
            select(func.count())
            .select_from(SavedShare)
            .join(Share, SavedShare.share_id == Share.id)
            .join(Task, Share.task_id == Task.id)
            .where(SavedShare.user_id == user_id)
        )
        if search:
            query = query.where(task_title_col.ilike(f"%{search}%"))
        result = await db.exec(query)
        return result.one() or 0

    async def list_saved_share_rows(
        self,
        db: AsyncSession,
        user_id: int,
        page: int,
        page_size: int,
        sort_by: str,
        sort_order: str,
        search: str | None = None,
    ) -> list[tuple[SavedShare, Task, Share, User]]:
        query = (
            select(SavedShare, Task, Share, User)
            .join(Share, SavedShare.share_id == Share.id)
            .join(Task, Share.task_id == Task.id)
            .join(User, Share.owner_user_id == User.id)
            .where(SavedShare.user_id == user_id)
        )
        if search:
            query = query.where(task_title_col.ilike(f"%{search}%"))

        order_func = desc if sort_order == "desc" else lambda field: field.asc()
        if sort_by == "title":
            query = query.order_by(order_func(Task.title))
        else:
            query = query.order_by(order_func(SavedShare.created_at))

        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await db.exec(query)
        return list(result.all())

    async def list_task_file_kinds(
        self,
        db: AsyncSession,
        task_ids: list[int],
        file_kinds: list[str],
    ) -> list[tuple[int, str]]:
        if not task_ids:
            return []
        result = await db.exec(
            select(File.task_id, File.kind).where(
                file_task_id_col.in_(task_ids),
                File.kind.in_(file_kinds),
            )
        )
        return list(result.all())

    async def list_task_files_by_kind(
        self,
        db: AsyncSession,
        task_id: int,
        file_type: str,
    ) -> list[File]:
        result = await db.exec(
            select(File)
            .where(File.task_id == task_id)
            .where(File.kind == file_type)
            .order_by(File.page_number)
        )
        return list(result.all())

    async def get_saved_share_by_share_and_user(
        self,
        db: AsyncSession,
        share_id: int,
        user_id: int,
    ) -> SavedShare | None:
        result = await db.exec(
            select(SavedShare).where(
                SavedShare.share_id == share_id,
                SavedShare.user_id == user_id,
            )
        )
        return result.one_or_none()

    def add_saved_share(
        self,
        db: AsyncSession,
        share_id: int,
        user_id: int,
    ) -> SavedShare:
        saved_share = SavedShare(share_id=share_id, user_id=user_id)
        db.add(saved_share)
        return saved_share

    async def delete_saved_shares(
        self,
        db: AsyncSession,
        ids: list[int],
        user_id: int,
    ) -> None:
        await db.execute(
            delete(SavedShare).where(
                saved_share_id_col.in_(ids),
                SavedShare.user_id == user_id,
            )
        )


shares_repository = SharesRepository()
