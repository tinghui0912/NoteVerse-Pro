from __future__ import annotations

import hashlib
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app.api.deps import get_current_user, get_db
from app.main import app
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models import (
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    StorageQuotaPolicy,
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    StorageUsageEvent,
    StorageUsageReservation,
    Upload,
    User,
)
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.db.models.user import UserRole
from app.modules.files.service import FilesService
from app.modules.files.dependencies import get_files_service
from app.modules.revisions.schemas import RevisionCreateRequest
from app.modules.revisions.service import RevisionService
from app.modules.scores.service import ScoreService
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.storage import LocalFileStorage
from app.utils.timezone import utc_now_naive


MUSICXML_BASE = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>
"""

MUSICXML_CHANGED = MUSICXML_BASE.replace("<step>C</step>", "<step>D</step>")


class AsyncSessionAdapter:
    def __init__(self, session: Session) -> None:
        self.session = session

    async def execute(self, statement, params=None, *args, **kwargs):  # type: ignore[no-untyped-def]
        return self.session.execute(statement, params=params, *args, **kwargs)

    async def commit(self) -> None:
        self.session.commit()

    async def rollback(self) -> None:
        self.session.rollback()

    async def flush(self) -> None:
        self.session.flush()

    async def refresh(self, instance) -> None:  # type: ignore[no-untyped-def]
        self.session.refresh(instance)

    async def get(self, model, identity):  # type: ignore[no-untyped-def]
        return self.session.get(model, identity)

    async def delete(self, instance) -> None:  # type: ignore[no-untyped-def]
        self.session.delete(instance)

    def add(self, instance) -> None:  # type: ignore[no-untyped-def]
        self.session.add(instance)


@pytest.fixture
def storage_usage_session(tmp_path) -> Iterator[tuple[Session, LocalFileStorage]]:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
        del connection_record
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    storage = LocalFileStorage(storage_root=str(tmp_path / "storage"))
    with Session(engine) as session:
        session.add(
            User(
                id=1,
                email="owner@example.com",
                display_name="Owner",
                password_hash="hash",
                role=UserRole.user,
            )
        )
        session.add(
            StorageQuotaPolicy(
                plan_code="FREE",
                quota_limit_bytes=1000,
                created_at=utc_now_naive(),
                updated_at=utc_now_naive(),
            )
        )
        session.commit()
        yield session, storage


def _set_quota(session: Session, limit_bytes: int) -> None:
    policy = session.execute(
        select(StorageQuotaPolicy).where(StorageQuotaPolicy.plan_code == "FREE")
    ).scalar_one()
    policy.quota_limit_bytes = limit_bytes
    policy.updated_at = utc_now_naive()
    session.add(policy)
    account = session.get(StorageUsageAccount, 1)
    if account is not None:
        account.quota_limit_bytes = limit_bytes
        account.updated_at = utc_now_naive()
        session.add(account)
    session.commit()


def _seed_score_with_source(
    session: Session,
    storage: LocalFileStorage,
    *,
    owner_user_id: int = 1,
    content: str = MUSICXML_BASE,
) -> tuple[Score, ScoreRevision, ScoreRevisionSource]:
    content_bytes = content.encode("utf-8")
    content_hash = hashlib.sha256(content_bytes).hexdigest()
    score = Score(
        score_uuid="score-storage-test",
        owner_user_id=owner_user_id,
        title="Storage Test",
        version=1,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(score)
    session.flush()
    score_id = score.id
    assert score_id is not None
    revision = ScoreRevision(
        revision_uuid="revision-storage-test-1",
        score_id=score_id,
        revision_number=1,
        content_hash=content_hash,
        origin=RevisionOrigin.OMR,
        created_by_user_id=owner_user_id,
        created_at=utc_now_naive(),
    )
    session.add(revision)
    session.flush()
    revision_id = revision.id
    assert revision_id is not None
    stored = storage.put_bytes(
        key="scores/score-storage-test/revisions/revision-storage-test-1/score.musicxml",
        content=content_bytes,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    source = ScoreRevisionSource(
        source_uuid="source-storage-test-1",
        revision_id=revision_id,
        format=RevisionSourceFormat.MUSICXML,
        storage_backend=storage.backend_name,
        storage_key=stored.storage_key,
        filename=stored.filename,
        mime_type="application/vnd.recordare.musicxml+xml",
        size_bytes=stored.size_bytes,
        sha256=content_hash,
        generator="test",
        generator_version="1",
        created_at=utc_now_naive(),
    )
    session.add(source)
    score.head_revision_id = revision_id
    session.add(score)
    session.commit()
    return score, revision, source


def _count(session: Session, model: type) -> int:
    return session.execute(select(func.count()).select_from(model)).scalar_one()


def test_storage_usage_reservation_blocks_when_quota_would_be_exceeded(
    storage_usage_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = storage_usage_session
    _set_quota(session, 8)

    with pytest.raises(ValidationException) as exc_info:
        storage_usage_service.reserve_sync(
            session,
            user_id=1,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=9,
            reason="test_upload",
        )

    assert exc_info.value.code == ErrorCode.STORAGE_QUOTA_EXCEEDED
    session.rollback()
    assert _count(session, StorageUsageReservation) == 0


def test_storage_usage_requires_seeded_default_policy() -> None:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            User(
                id=1,
                email="owner@example.com",
                display_name="Owner",
                password_hash="hash",
                role=UserRole.user,
            )
        )
        session.commit()

        with pytest.raises(ResourceNotFoundException) as exc_info:
            storage_usage_service.reserve_sync(
                session,
                user_id=1,
                category=StorageUsageCategory.UPLOAD,
                bytes_count=1,
                reason="test_upload",
            )

    assert exc_info.value.code == ErrorCode.STORAGE_QUOTA_POLICY_NOT_CONFIGURED


def test_storage_usage_api_returns_quota_and_breakdown(
    client: TestClient,
    storage_usage_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = storage_usage_session
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=120,
        reason="seed_source",
        object_type="score_revision_source",
        object_id="source-api",
        storage_key="scores/api/source.musicxml",
    )
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.DERIVED_RENDER,
        bytes_count=30,
        reason="seed_render",
        object_type="score_render_asset",
        object_id="render-api",
        storage_key="scores/api/render.svg",
    )
    user = session.get(User, 1)
    assert user is not None

    async def override_get_db():
        yield AsyncSessionAdapter(session)

    async def override_current_user():
        return user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user
    try:
        response = client.get("/api/v1/me/storage-usage")
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["quota"] == {
        "used_bytes": 120,
        "reserved_bytes": 0,
        "limit_bytes": 1000,
        "available_bytes": 880,
    }
    breakdown = {
        item["category"]: item
        for item in payload["data"]["breakdown"]
    }
    assert breakdown["SOURCE"]["used_bytes"] == 120
    assert breakdown["SOURCE"]["counts_toward_quota"] is True
    assert breakdown["DERIVED_RENDER"]["used_bytes"] == 30
    assert breakdown["DERIVED_RENDER"]["counts_toward_quota"] is False


def test_storage_usage_commit_and_release_updates_account_and_counter(
    storage_usage_session: tuple[Session, LocalFileStorage],
) -> None:
    session, _storage = storage_usage_session

    handle = storage_usage_service.reserve_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=40,
        reason="revision_create",
    )
    account = session.get(StorageUsageAccount, 1)
    assert account is not None
    assert account.used_bytes == 0
    assert account.reserved_bytes == 40

    storage_usage_service.commit_reservation_sync(
        session,
        handle.reservation_id,
        object_type="score_revision_source",
        object_id="source-1",
        storage_key="scores/1/revisions/1/score.musicxml",
    )
    session.refresh(account)
    counter = session.execute(
        select(StorageUsageCounter).where(
            StorageUsageCounter.user_id == 1,
            StorageUsageCounter.category == StorageUsageCategory.SOURCE,
        )
    ).scalar_one()
    assert account.used_bytes == 40
    assert account.reserved_bytes == 0
    assert counter.used_bytes == 40
    assert counter.reserved_bytes == 0

    storage_usage_service.record_release_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=15,
        reason="delete_score",
        object_type="score_revision_source",
        object_id="source-1",
        storage_key="scores/1/revisions/1/score.musicxml",
    )
    session.refresh(account)
    session.refresh(counter)
    event = session.execute(
        select(StorageUsageEvent).where(StorageUsageEvent.delta_bytes < 0)
    ).scalar_one()
    assert account.used_bytes == 25
    assert counter.used_bytes == 25
    assert event.delta_bytes == -15


@pytest.mark.asyncio
async def test_file_upload_quota_exceeded_does_not_store_file(
    storage_usage_session: tuple[Session, LocalFileStorage],
    tmp_path,
) -> None:
    session, storage = storage_usage_session
    _set_quota(session, 3)
    service = FilesService(storage=storage)
    db = AsyncSessionAdapter(session)
    user = session.get(User, 1)
    assert user is not None

    upload = type(
            "TestUpload",
            (),
            {
                "filename": "too-large.png",
                "content_type": "image/png",
                "read": lambda self: _async_bytes(b"123456789"),
            },
        )()
    with pytest.raises(ValidationException) as exc_info:
        await service.upload_file(db, user, upload)  # type: ignore[arg-type]

    assert exc_info.value.code == ErrorCode.STORAGE_QUOTA_EXCEEDED
    session.rollback()
    assert _count(session, Upload) == 0
    storage_root = tmp_path / "storage"
    assert not storage_root.exists() or not any(storage_root.rglob("*"))


def test_file_upload_api_returns_storage_quota_error_without_storing_file(
    client: TestClient,
    storage_usage_session: tuple[Session, LocalFileStorage],
    tmp_path,
) -> None:
    session, storage = storage_usage_session
    _set_quota(session, 3)
    user = session.get(User, 1)
    assert user is not None

    async def override_get_db():
        yield AsyncSessionAdapter(session)

    async def override_current_user():
        return user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user
    app.dependency_overrides[get_files_service] = lambda: FilesService(storage=storage)
    try:
        response = client.post(
            "/api/v1/files/upload",
            files={"file": ("too-large.png", b"123456789", "image/png")},
        )
    finally:
        app.dependency_overrides.pop(get_files_service, None)
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 422
    payload = response.json()
    assert payload["success"] is False
    assert payload["code"] == ErrorCode.STORAGE_QUOTA_EXCEEDED
    assert payload["details"]["requested_bytes"] == 9
    session.rollback()
    assert _count(session, Upload) == 0
    storage_root = tmp_path / "storage"
    assert not storage_root.exists() or not any(storage_root.rglob("*"))


async def _async_bytes(content: bytes) -> bytes:
    return content


@pytest.mark.asyncio
async def test_revision_create_quota_exceeded_does_not_create_revision_or_source(
    storage_usage_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = storage_usage_session
    _seed_score_with_source(session, storage)
    _set_quota(session, 1)
    service = RevisionService(storage=storage)
    db = AsyncSessionAdapter(session)

    base = session.execute(select(ScoreRevision)).scalar_one()
    with pytest.raises(ValidationException) as exc_info:
        await service.create(
            db,
            "score-storage-test",
            1,
            RevisionCreateRequest(
                base_revision_id=base.revision_uuid,
                content=MUSICXML_CHANGED,
                origin=RevisionOrigin.EDIT,
            ),
        )

    assert exc_info.value.code == ErrorCode.STORAGE_QUOTA_EXCEEDED
    session.rollback()
    assert _count(session, ScoreRevision) == 1
    assert _count(session, ScoreRevisionSource) == 1
    assert _count(session, StorageUsageReservation) == 0


@pytest.mark.asyncio
async def test_score_delete_releases_source_usage_and_storage_object(
    storage_usage_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = storage_usage_session
    score, _revision, source = _seed_score_with_source(session, storage)
    assert score.score_uuid is not None
    assert source.size_bytes is not None
    source_storage_key = source.storage_key
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=source.size_bytes,
        reason="seed_source",
        object_type="score_revision_source",
        object_id=source.source_uuid,
        storage_key=source_storage_key,
    )
    assert storage.exists(source_storage_key)

    service = ScoreService(storage=storage)
    await service.delete(AsyncSessionAdapter(session), score.score_uuid, 1)

    account = session.get(StorageUsageAccount, 1)
    counter = session.execute(
        select(StorageUsageCounter).where(
            StorageUsageCounter.user_id == 1,
            StorageUsageCounter.category == StorageUsageCategory.SOURCE,
        )
    ).scalar_one()
    assert account is not None
    assert account.used_bytes == 0
    assert counter.used_bytes == 0
    assert not storage.exists(source_storage_key)
