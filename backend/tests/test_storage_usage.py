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
    ImportArtifact,
    ImportJob,
    ImportJobUpload,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    StoredObject,
    StorageQuotaPolicy,
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    StorageUsageEvent,
    StorageUsageReservation,
    Upload,
    User,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import RevisionOrigin, RevisionSourceFormat, ScoreDeletionStatus
from app.modules.files.service import FilesService
from app.modules.files.dependencies import get_files_service
from app.modules.import_jobs.service import ImportJobService
from app.modules.revisions.schemas import RevisionCreateRequest
from app.modules.revisions.service import RevisionService
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.modules.scores.service import ScoreService
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from tests.support.object_storage import InMemoryObjectStorage
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

    async def scalars(self, statement):
        return self.session.scalars(statement)

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
def storage_usage_session(tmp_path) -> Iterator[tuple[Session, InMemoryObjectStorage]]:
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
    storage = InMemoryObjectStorage()
    with Session(engine) as session:
        session.add(
            User(
                id=1,
                email="owner@example.com",
                display_name="Owner",
                password_hash="hash",
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
    storage: InMemoryObjectStorage,
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
        stored_object=StoredObject(
            object_key=stored.object_key,
            content_type="application/vnd.recordare.musicxml+xml",
            byte_size=stored.size_bytes,
            sha256=content_hash,
        ),
        filename=stored.object_key.rsplit("/", 1)[-1],
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
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
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

    assert exc_info.value.code == ErrorCode.QUOTA_CHECK_UNAVAILABLE


def test_storage_usage_api_returns_quota_and_breakdown(
    client: TestClient,
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
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
    breakdown = {item["category"]: item for item in payload["data"]["breakdown"]}
    assert breakdown["SOURCE"]["used_bytes"] == 120
    assert breakdown["SOURCE"]["counts_toward_quota"] is True
    assert breakdown["DERIVED_RENDER"]["used_bytes"] == 30
    assert breakdown["DERIVED_RENDER"]["counts_toward_quota"] is False


def test_storage_usage_commit_and_release_updates_account_and_counter(
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
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
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
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
    assert not storage.objects


def test_file_upload_api_returns_storage_quota_error_without_storing_file(
    client: TestClient,
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
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
    assert payload["public_code"] == ErrorCode.STORAGE_QUOTA_EXCEEDED
    assert "internal_details" not in payload
    session.rollback()
    assert _count(session, Upload) == 0
    assert not storage.objects


def test_file_upload_api_hides_storage_key(
    client: TestClient,
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = storage_usage_session
    _set_quota(session, 1024)
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
            files={"file": ("score.png", b"image-bytes", "image/png")},
        )
    finally:
        app.dependency_overrides.pop(get_files_service, None)
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["file_id"]
    assert payload["data"]["filename"] == "score.png"
    assert payload["data"]["size"] == len(b"image-bytes")
    assert "storage_key" not in payload["data"]


async def _async_bytes(content: bytes) -> bytes:
    return content


@pytest.mark.asyncio
async def test_revision_create_quota_exceeded_does_not_create_revision_or_source(
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
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
                expected_head_revision_id=base.revision_uuid,
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
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = storage_usage_session
    score, _revision, source = _seed_score_with_source(session, storage)
    assert score.score_uuid is not None
    assert source.stored_object.byte_size is not None
    source_storage_key = source.stored_object.object_key
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=source.stored_object.byte_size,
        reason="seed_source",
        object_type="score_revision_source",
        object_id=source.source_uuid,
        storage_key=source_storage_key,
    )
    assert storage.exists(source_storage_key)

    service = ScoreService(storage=storage)
    await service.delete(AsyncSessionAdapter(session), score.score_uuid, 1)

    marked_score = session.get(Score, score.id)
    assert marked_score is not None
    assert marked_score.deletion_status == ScoreDeletionStatus.DELETING
    assert marked_score.deleted_at is not None

    result = service.lifecycle_service.cleanup_deleting_scores(session)
    assert result.scores_deleted == 1

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


def test_score_deletion_cleanup_records_retry_state_on_failure(
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session, storage = storage_usage_session
    score, _revision, _source = _seed_score_with_source(session, storage)
    assert score.id is not None
    now = utc_now_naive()
    score.deletion_status = ScoreDeletionStatus.DELETING
    score.deletion_requested_at = now
    score.deleted_at = now
    session.add(score)
    session.commit()

    lifecycle = ScoreLifecycleService(storage=storage)

    def fail_cleanup(db: Session, cleanup_score: Score) -> object:
        _ = db, cleanup_score
        raise RuntimeError("object storage temporarily unavailable")

    monkeypatch.setattr(lifecycle, "cleanup_deleting_score", fail_cleanup)

    result = lifecycle.cleanup_deleting_scores(session)

    assert result.scores_deleted == 0
    stored = session.get(Score, score.id)
    assert stored is not None
    assert stored.deletion_status == ScoreDeletionStatus.DELETING
    assert stored.cleanup_attempt_count == 1
    assert stored.next_cleanup_at is not None
    assert stored.next_cleanup_at > now
    assert stored.deletion_error == "object storage temporarily unavailable"


@pytest.mark.asyncio
async def test_score_delete_cleans_single_origin_import_job_storage(
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = storage_usage_session
    score, _revision, source = _seed_score_with_source(session, storage)
    assert score.id is not None
    assert score.score_uuid is not None
    assert source.stored_object.byte_size is not None
    job_uuid = "score-delete-origin-job"
    upload = storage.put_bytes(
        key="uploads/origin-upload.png",
        content=b"uploaded image",
        content_type="image/png",
    )
    review_source = storage.put_bytes(
        key=f"jobs/{job_uuid}/review_musicxml/review.musicxml",
        content=b"<score-partwise />",
        content_type="application/vnd.recordare.musicxml+xml",
    )
    job = ImportJob(
        id=1201,
        job_uuid=job_uuid,
        user_id=1,
        state=ImportJobState.CONFIRMED,
        progress=100,
        score_id=score.id,
    )
    session.add_all(
        [
            job,
            StoredObject(
                id=1302,
                sha256="9d65812087c4c1d2c9fa7d298b12c5224c0a29ed5b752296874c2b1bf6711f9d",
                object_key=upload.object_key,
                byte_size=upload.size_bytes,
                content_type="image/png",
            ),
            Upload(
                id=1202,
                stored_object_id=1302,
                original_filename="origin.png",
                uploader_user_id=1,
            ),
        ]
    )
    session.commit()
    score.originating_job_id = 1201
    session.add(score)
    session.add(ImportJobUpload(job_id=1201, upload_id=1202, page_number=1, sort_order=1))
    session.add(
        ImportArtifact(
            artifact_uuid="origin-review-source",
            job_id=1201,
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            stored_object=StoredObject(
                object_key=review_source.object_key,
                content_type="application/vnd.recordare.musicxml+xml",
                byte_size=review_source.size_bytes,
                sha256=hashlib.sha256(storage.read_bytes(review_source.object_key)).hexdigest(),
            ),
            filename=review_source.object_key.rsplit("/", 1)[-1],
        )
    )
    session.commit()
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=source.stored_object.byte_size,
        reason="seed_source",
        object_type="score_revision_source",
        object_id=source.source_uuid,
        storage_key=source.stored_object.object_key,
    )
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.UPLOAD,
        bytes_count=upload.size_bytes,
        reason="seed_upload",
        object_type="upload",
        object_id="9d65812087c4c1d2c9fa7d298b12c5224c0a29ed5b752296874c2b1bf6711f9d",
        storage_key=upload.object_key,
    )
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.TEMP_IMPORT,
        bytes_count=review_source.size_bytes,
        reason="seed_import_artifact",
        object_type="import_artifact",
        object_id="origin-review-source",
        storage_key=review_source.object_key,
    )
    source_storage_key = source.stored_object.object_key
    upload_storage_key = upload.object_key
    review_source_storage_key = review_source.object_key

    service = ScoreService(storage=storage)
    await service.delete(AsyncSessionAdapter(session), score.score_uuid, 1)

    marked_score = session.get(Score, score.id)
    assert marked_score is not None
    assert marked_score.deletion_status == ScoreDeletionStatus.DELETING

    result = service.lifecycle_service.cleanup_deleting_scores(session)
    assert result.scores_deleted == 1

    assert session.get(Score, score.id) is None
    assert session.get(ImportJob, 1201) is None
    assert session.get(Upload, 1202) is None
    assert not storage.exists(source_storage_key)
    assert not storage.exists(upload_storage_key)
    assert not storage.exists(review_source_storage_key)
    account = session.get(StorageUsageAccount, 1)
    assert account is not None
    assert account.used_bytes == 0


@pytest.mark.asyncio
async def test_import_job_delete_releases_owned_upload_and_temp_artifacts(
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = storage_usage_session
    job_uuid = "job-delete-owned-storage"
    upload = storage.put_bytes(
        key="uploads/delete-owned-upload.png",
        content=b"uploaded image",
        content_type="image/png",
    )
    review_source = storage.put_bytes(
        key=f"jobs/{job_uuid}/review_musicxml/review.musicxml",
        content=b"<score-partwise />",
        content_type="application/vnd.recordare.musicxml+xml",
    )
    thumbnail = storage.put_bytes(
        key=f"jobs/{job_uuid}/review_preview_image/page-1.png",
        content=b"thumbnail",
        content_type="image/png",
    )
    job = ImportJob(
        id=1001,
        job_uuid=job_uuid,
        user_id=1,
        state=ImportJobState.PENDING_REVIEW,
        progress=100,
    )
    session.add_all(
        [
            job,
            StoredObject(
                id=1303,
                sha256="a4117a1f0ff460c600674eeeeb14cf60f9f4ddc1c63b49a64d4f5b2ff873f7cb",
                object_key=upload.object_key,
                byte_size=upload.size_bytes,
                content_type="image/png",
            ),
            Upload(
                id=1002,
                stored_object_id=1303,
                original_filename="upload.png",
                uploader_user_id=1,
            ),
        ]
    )
    session.commit()
    session.add(ImportJobUpload(job_id=1001, upload_id=1002, page_number=1, sort_order=1))
    session.add(
        ImportArtifact(
            artifact_uuid="delete-owned-review-source",
            job_id=1001,
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            stored_object=StoredObject(
                object_key=review_source.object_key,
                content_type="application/vnd.recordare.musicxml+xml",
                byte_size=review_source.size_bytes,
                sha256=hashlib.sha256(storage.read_bytes(review_source.object_key)).hexdigest(),
            ),
            filename=review_source.object_key.rsplit("/", 1)[-1],
        )
    )
    session.add(
        ImportArtifact(
            artifact_uuid="delete-owned-thumbnail",
            job_id=1001,
            kind=ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
            stored_object=StoredObject(
                object_key=thumbnail.object_key,
                content_type="image/png",
                byte_size=thumbnail.size_bytes,
                sha256=hashlib.sha256(storage.read_bytes(thumbnail.object_key)).hexdigest(),
            ),
            filename=thumbnail.object_key.rsplit("/", 1)[-1],
        )
    )
    session.commit()
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.UPLOAD,
        bytes_count=upload.size_bytes,
        reason="seed_upload",
        object_type="upload",
        object_id="a4117a1f0ff460c600674eeeeb14cf60f9f4ddc1c63b49a64d4f5b2ff873f7cb",
        storage_key=upload.object_key,
    )
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.TEMP_IMPORT,
        bytes_count=review_source.size_bytes + thumbnail.size_bytes,
        reason="seed_import_artifact",
        object_type="import_artifact",
        object_id=job_uuid,
    )

    await ImportJobService(storage=storage).delete(AsyncSessionAdapter(session), job_uuid, 1)

    assert session.get(ImportJob, 1001) is None
    assert session.get(Upload, 1002) is None
    assert not storage.exists(upload.object_key)
    assert not storage.exists(review_source.object_key)
    assert not storage.exists(thumbnail.object_key)
    assert not any(key.startswith(f"jobs/{job_uuid}/") for key in storage.objects)
    account = session.get(StorageUsageAccount, 1)
    assert account is not None
    assert account.used_bytes == 0
    counters = {
        counter.category: counter.used_bytes
        for counter in session.execute(
            select(StorageUsageCounter).where(StorageUsageCounter.user_id == 1)
        ).scalars()
    }
    assert counters[StorageUsageCategory.UPLOAD] == 0
    assert counters[StorageUsageCategory.TEMP_IMPORT] == 0


@pytest.mark.asyncio
async def test_import_job_delete_keeps_shared_upload_usage_and_storage(
    storage_usage_session: tuple[Session, InMemoryObjectStorage],
) -> None:
    session, storage = storage_usage_session
    upload = storage.put_bytes(
        key="uploads/shared-upload.png",
        content=b"shared upload",
        content_type="image/png",
    )
    session.add_all(
        [
            ImportJob(
                id=1101,
                job_uuid="job-delete-shared-a",
                user_id=1,
                state=ImportJobState.PENDING_REVIEW,
                progress=100,
            ),
            ImportJob(
                id=1102,
                job_uuid="job-delete-shared-b",
                user_id=1,
                state=ImportJobState.PENDING_REVIEW,
                progress=100,
            ),
            StoredObject(
                id=1304,
                sha256="e14d13d88ed945fc5a843770a4f2433ab825ce077d86770120166426391033a9",
                object_key=upload.object_key,
                byte_size=upload.size_bytes,
                content_type="image/png",
            ),
            Upload(
                id=1103,
                stored_object_id=1304,
                original_filename="shared.png",
                uploader_user_id=1,
            ),
        ]
    )
    session.commit()
    session.add_all(
        [
            ImportJobUpload(job_id=1101, upload_id=1103, page_number=1, sort_order=1),
            ImportJobUpload(job_id=1102, upload_id=1103, page_number=1, sort_order=1),
        ]
    )
    session.commit()
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.UPLOAD,
        bytes_count=upload.size_bytes,
        reason="seed_upload",
        object_type="upload",
        object_id="e14d13d88ed945fc5a843770a4f2433ab825ce077d86770120166426391033a9",
        storage_key=upload.object_key,
    )

    await ImportJobService(storage=storage).delete(
        AsyncSessionAdapter(session),
        "job-delete-shared-a",
        1,
    )

    assert session.get(ImportJob, 1101) is None
    assert session.get(ImportJob, 1102) is not None
    assert session.get(Upload, 1103) is not None
    assert storage.exists(upload.object_key)
    account = session.get(StorageUsageAccount, 1)
    assert account is not None
    assert account.used_bytes == upload.size_bytes


@pytest.mark.asyncio
@pytest.mark.parametrize("preexisting_object", [False, True])
async def test_files_owns_sha_key_dedup_and_last_upload_deletion(
    storage_usage_session, monkeypatch, preexisting_object
):
    import io
    import hashlib
    from unittest.mock import Mock
    from starlette.datastructures import UploadFile, Headers
    from app.modules.files.service import blob_object_key

    session, storage = storage_usage_session
    _set_quota(session, 1024)
    content = b"identical image bytes"
    key = blob_object_key(hashlib.sha256(content).hexdigest(), ".png")
    if preexisting_object:
        storage.put_bytes(key=key, content=content, content_type="image/png")
    put = Mock(wraps=storage.put_bytes)
    monkeypatch.setattr(storage, "put_bytes", put)
    service, db, user = (
        FilesService(storage=storage),
        AsyncSessionAdapter(session),
        session.get(User, 1),
    )

    def upload(name):
        return UploadFile(
            io.BytesIO(content), filename=name, headers=Headers({"content-type": "image/png"})
        )

    first = await service.upload_file(db, user, upload("first.png"))
    second = await service.upload_file(db, user, upload("second.png"))
    blobs = session.scalars(select(StoredObject)).all()
    assert len(blobs) == 1 and blobs[0].object_key == key
    uploads = session.scalars(select(Upload)).all()
    assert len(uploads) == 2 and all(row.stored_object_id == blobs[0].id for row in uploads)
    assert put.call_count == (0 if preexisting_object else 1)
    if not preexisting_object:
        put.assert_called_once_with(key=key, content=content, content_type="image/png")
    await service.delete_uploaded_file(db, user, first.file_id)
    assert storage.exists(key)
    await service.delete_uploaded_file(db, user, second.file_id)
    assert not storage.exists(key)
    assert not session.scalars(select(StoredObject)).all()
    account = session.get(StorageUsageAccount, 1)
    assert account.used_bytes == account.reserved_bytes == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("preexisting_object", [False, True])
async def test_files_failed_upload_retires_only_newly_written_bytes(
    storage_usage_session, monkeypatch, preexisting_object
):
    import io
    import hashlib
    from unittest.mock import AsyncMock
    from starlette.datastructures import UploadFile, Headers
    from app.core.exceptions import FileException
    from app.modules.files.service import blob_object_key

    session, storage = storage_usage_session
    _set_quota(session, 1024)
    content = b"image upload"
    key = blob_object_key(hashlib.sha256(content).hexdigest(), ".png")
    if preexisting_object:
        storage.put_bytes(key=key, content=content, content_type="image/png")
    service = FilesService(storage=storage)
    monkeypatch.setattr(
        service.repository,
        "create_upload",
        AsyncMock(side_effect=RuntimeError("database write failed")),
    )
    upload = UploadFile(
        io.BytesIO(content), filename="image.png", headers=Headers({"content-type": "image/png"})
    )
    with pytest.raises(FileException):
        await service.upload_file(AsyncSessionAdapter(session), session.get(User, 1), upload)
    assert storage.exists(key) is preexisting_object
    assert not session.scalars(select(StoredObject)).all()
    account = session.get(StorageUsageAccount, 1)
    assert account.used_bytes == account.reserved_bytes == 0
