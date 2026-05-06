from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import Enum as SAEnum
from sqlmodel import Session, SQLModel, create_engine

from app.db.models.file import File, Upload
from app.db.models.practice import (
    PracticeReportStatus,
    PracticeSession,
    PracticeSessionState,
    PracticeSourceType,
)
from app.db.models.share import SavedShare, Share
from app.db.models.task import Task, TaskState, TaskStep, TaskStepStatus
from app.db.models.user import User, UserRole
from app.modules.files.repository import FilesRepository
from app.modules.practice.repository import PracticeRepository
from app.modules.shares.repository import SharesRepository
from app.modules.tasks.repository import TaskRepository
from app.shared.file_kinds import FileKind


def _enum_values(enum_cls):
    return [member.value for member in enum_cls]


def _patch_sqlite_enums() -> None:
    User.__table__.c.role.type = SAEnum(
        UserRole,
        values_callable=_enum_values,
        native_enum=False,
    )
    Task.__table__.c.state.type = SAEnum(
        TaskState,
        values_callable=_enum_values,
        native_enum=False,
    )
    TaskStep.__table__.c.status.type = SAEnum(
        TaskStepStatus,
        values_callable=_enum_values,
        native_enum=False,
    )
    PracticeSession.__table__.c.source_type.type = SAEnum(
        PracticeSourceType,
        values_callable=_enum_values,
        native_enum=False,
    )
    PracticeSession.__table__.c.state.type = SAEnum(
        PracticeSessionState,
        values_callable=_enum_values,
        native_enum=False,
    )
    PracticeSession.__table__.c.report_status.type = SAEnum(
        PracticeReportStatus,
        values_callable=_enum_values,
        native_enum=False,
    )


_patch_sqlite_enums()


class AsyncSessionAdapter:
    """Minimal async-shaped wrapper around a sync SQLModel session for tests."""

    def __init__(self, session: Session):
        self.session = session

    async def execute(self, statement):
        return self.session.execute(statement)

    async def exec(self, statement):
        return self.session.exec(statement)

    async def commit(self):
        self.session.commit()

    async def refresh(self, instance):
        self.session.refresh(instance)

    def add(self, instance):
        self.session.add(instance)


@pytest.fixture
def db_backed_session() -> Iterator[AsyncSessionAdapter]:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    session = Session(engine)

    user_1 = User(
        id=1,
        email="user1@example.com",
        display_name="user1",
        password_hash="hash-1",
        role=UserRole.user,
        is_active=True,
    )
    user_2 = User(
        id=2,
        email="user2@example.com",
        display_name="user2",
        password_hash="hash-2",
        role=UserRole.admin,
        is_active=True,
    )
    task_1 = Task(
        id=101,
        task_uuid="task-1",
        user_id=1,
        state=TaskState.SUCCESS,
        title="Moonlight",
        progress=100,
    )
    task_2 = Task(
        id=102,
        task_uuid="task-2",
        user_id=1,
        state=TaskState.PROGRESS,
        title="Etude",
        progress=50,
    )
    task_3 = Task(
        id=103,
        task_uuid="task-3",
        user_id=2,
        state=TaskState.FAILURE,
        title="Nocturne",
        progress=0,
    )
    share_1 = Share(
        id=201,
        task_id=101,
        owner_user_id=1,
        token="share-1",
        can_download=True,
        can_edit=False,
    )
    saved_share_1 = SavedShare(
        id=301,
        user_id=2,
        share_id=201,
    )
    file_1 = File(
        id=401,
        task_id=101,
        kind=FileKind.FINAL_IMAGE,
        path="output/task-1/page-01.png",
        page=1,
        mime_type="image/png",
    )
    file_2 = File(
        id=402,
        task_id=101,
        kind=FileKind.FINAL_XML,
        path="output/task-1/final.xml",
        mime_type="application/xml",
    )
    upload_1 = Upload(
        id=501,
        sha256="sha-1",
        stored_filename="stored-1.png",
        original_filename="score.png",
        size_bytes=123,
        mime_type="image/png",
        uploader_user_id=1,
    )
    practice_session_1 = PracticeSession(
        id=601,
        session_uuid="session-1",
        task_id=101,
        user_id=1,
        source_type=PracticeSourceType.final,
        state=PracticeSessionState.CREATED,
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        report_status=PracticeReportStatus.NOT_REQUESTED,
    )

    for instance in [
        user_1,
        user_2,
        task_1,
        task_2,
        task_3,
        share_1,
        saved_share_1,
        file_1,
        file_2,
        upload_1,
        practice_session_1,
    ]:
        session.add(instance)
    session.commit()

    try:
        yield AsyncSessionAdapter(session)
    finally:
        session.close()
        engine.dispose()


@pytest.mark.asyncio
async def test_task_repository_counts_and_lists_tasks(db_backed_session: AsyncSessionAdapter) -> None:
    repository = TaskRepository()

    total = await repository.count_tasks(db_backed_session, user_id=1)
    filtered = await repository.count_tasks(
        db_backed_session,
        user_id=1,
        state=TaskState.SUCCESS,
        search="Moon",
    )
    tasks = await repository.list_tasks(
        db_backed_session,
        user_id=1,
        page=1,
        page_size=10,
        sort_by="title",
        sort_order="asc",
    )
    statuses = await repository.batch_status(
        db_backed_session,
        ["task-1", "task-2", "task-3"],
        user_id=1,
    )

    assert total == 2
    assert filtered == 1
    assert [task.task_uuid for task in tasks] == ["task-2", "task-1"]
    assert statuses == {
        "task-1": {"state": TaskState.SUCCESS, "progress": 100, "error": None},
        "task-2": {"state": TaskState.PROGRESS, "progress": 50, "error": None},
    }


@pytest.mark.asyncio
async def test_files_repository_upsert_and_lookup(db_backed_session: AsyncSessionAdapter) -> None:
    repository = FilesRepository()

    existing = await repository.get_upload_by_sha256(db_backed_session, "sha-1")
    assert existing is not None
    assert existing.stored_filename == "stored-1.png"

    created = await repository.upsert_upload(
        db_backed_session,
        sha256="sha-2",
        stored_filename="stored-2.png",
        original_filename="new.png",
        size_bytes=456,
        mime_type="image/png",
        uploader_user_id=2,
    )
    created.id = 502
    await db_backed_session.commit()

    fetched_new = await repository.get_upload_by_sha256(db_backed_session, "sha-2")
    task = await repository.get_task_by_uuid(db_backed_session, "task-1")
    files = await repository.list_task_files(db_backed_session, 101)
    final_xml_files = await repository.list_task_files_by_kind(
        db_backed_session,
        101,
        FileKind.FINAL_XML,
    )

    assert created.sha256 == "sha-2"
    assert fetched_new is not None
    assert fetched_new.original_filename == "new.png"
    assert task.task_uuid == "task-1"
    assert len(files) == 2
    assert len(final_xml_files) == 1
    assert final_xml_files[0].kind == FileKind.FINAL_XML


@pytest.mark.asyncio
async def test_shares_repository_counts_and_lists_saved_shares(db_backed_session: AsyncSessionAdapter) -> None:
    repository = SharesRepository()

    share = await repository.get_share_by_token(db_backed_session, "share-1")
    total_shares = await repository.count_shares_for_owner(db_backed_session, owner_user_id=1)
    saved_total = await repository.count_saved_shares(db_backed_session, user_id=2, search="Moon")
    rows = await repository.list_saved_share_rows(
        db_backed_session,
        user_id=2,
        page=1,
        page_size=10,
        sort_by="created_at",
        sort_order="desc",
        search="Moon",
    )

    assert share is not None
    assert total_shares == 1
    assert saved_total == 1
    assert len(rows) == 1

    saved_share, task, share_obj, owner = rows[0]
    assert saved_share.user_id == 2
    assert task.task_uuid == "task-1"
    assert share_obj.token == "share-1"
    assert owner.id == 1


@pytest.mark.asyncio
async def test_shares_repository_lists_owner_rows_with_joined_tasks(
    db_backed_session: AsyncSessionAdapter,
) -> None:
    repository = SharesRepository()

    rows = await repository.list_share_rows_for_owner(
        db_backed_session,
        owner_user_id=1,
        page=1,
        page_size=10,
    )

    assert len(rows) == 1
    share, task = rows[0]
    assert share.token == "share-1"
    assert task.task_uuid == "task-1"


@pytest.mark.asyncio
async def test_practice_repository_creates_and_updates_session(
    db_backed_session: AsyncSessionAdapter,
) -> None:
    repository = PracticeRepository()

    task = await repository.get_task_by_uuid(db_backed_session, "task-1")
    share = await repository.get_share_by_token(db_backed_session, "share-1")
    existing = await repository.get_session_by_uuid(db_backed_session, "session-1")

    assert task is not None
    assert share is not None
    assert existing is not None
    assert existing.state == PracticeSessionState.CREATED

    created = await repository.create_session(
        db_backed_session,
        PracticeSession(
            id=602,
            session_uuid="session-2",
            task_id=101,
            user_id=2,
            share_token="share-1",
            source_type=PracticeSourceType.final,
            state=PracticeSessionState.CREATED,
            sample_rate=22050,
            channels=1,
            frame_format="pcm_s16le",
            report_status=PracticeReportStatus.NOT_REQUESTED,
        ),
    )
    created.state = PracticeSessionState.PAUSED
    await repository.save_session(db_backed_session, created)

    refreshed = await repository.get_session_by_uuid(db_backed_session, "session-2")
    assert refreshed is not None
    assert refreshed.user_id == 2
    assert refreshed.share_token == "share-1"
    assert refreshed.state == PracticeSessionState.PAUSED
