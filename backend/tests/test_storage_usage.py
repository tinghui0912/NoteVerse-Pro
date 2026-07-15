from __future__ import annotations

import hashlib
import os
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
    PracticeReportStatus,
    PracticeSession,
    PracticeSessionState,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    StorageBlob,
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
from app.db.models.score_access import AccessOrigin
from app.db.models.score import RevisionOrigin, RevisionSourceFormat, ScoreDeletionStatus
from app.db.models.user import UserRole
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
    assert payload["public_code"] == ErrorCode.STORAGE_QUOTA_EXCEEDED
    assert "internal_details" not in payload
    session.rollback()
    assert _count(session, Upload) == 0
    storage_root = tmp_path / "storage"
    assert not storage_root.exists() or not any(storage_root.rglob("*"))


def test_file_upload_api_hides_storage_key(
    client: TestClient,
    storage_usage_session: tuple[Session, LocalFileStorage],
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
    storage_usage_session: tuple[Session, LocalFileStorage],
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
async def test_score_delete_removes_practice_sessions(
    storage_usage_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = storage_usage_session
    score, revision, source = _seed_score_with_source(session, storage)
    assert score.id is not None
    assert score.score_uuid is not None
    assert revision.id is not None
    assert source.size_bytes is not None
    session.add(
        PracticeSession(
            id=2001,
            session_uuid="practice-delete-with-score",
            score_id=score.id,
            revision_id=revision.id,
            access_origin=AccessOrigin.OWNER,
            user_id=1,
            state=PracticeSessionState.FINISHED,
            sample_rate=44100,
            channels=1,
            frame_format="float32",
            report_status=PracticeReportStatus.READY,
            report_payload='{"summary":"done"}',
        )
    )
    session.commit()
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=source.size_bytes,
        reason="seed_source",
        object_type="score_revision_source",
        object_id=source.source_uuid,
        storage_key=source.storage_key,
    )

    service = ScoreService(storage=storage)
    await service.delete(AsyncSessionAdapter(session), score.score_uuid, 1)

    marked_score = session.get(Score, score.id)
    assert marked_score is not None
    assert marked_score.deletion_status == ScoreDeletionStatus.DELETING

    result = service.lifecycle_service.cleanup_deleting_scores(session)
    assert result.scores_deleted == 1
    assert session.get(Score, score.id) is None
    assert session.get(PracticeSession, 2001) is None
    account = session.get(StorageUsageAccount, 1)
    assert account is not None
    assert account.used_bytes == 0


@pytest.mark.asyncio
async def test_score_delete_cleans_single_origin_import_job_storage(
    storage_usage_session: tuple[Session, LocalFileStorage],
) -> None:
    session, storage = storage_usage_session
    score, _revision, source = _seed_score_with_source(session, storage)
    assert score.id is not None
    assert score.score_uuid is not None
    assert source.size_bytes is not None
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
    session.add_all([
        job,
        StorageBlob(
            id=1302,
            blob_uuid="origin-upload-blob",
            sha256="origin-upload-sha",
            storage_backend=storage.backend_name,
            storage_key=upload.storage_key,
            filename=upload.filename,
            size_bytes=upload.size_bytes,
            mime_type="image/png",
        ),
        Upload(
            id=1202,
            blob_id=1302,
            original_filename="origin.png",
            uploader_user_id=1,
        ),
    ])
    session.commit()
    score.originating_job_id = 1201
    session.add(score)
    session.add(ImportJobUpload(job_id=1201, upload_id=1202, page_number=1, sort_order=1))
    session.add(
        ImportArtifact(
            artifact_uuid="origin-review-source",
            job_id=1201,
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            storage_backend=storage.backend_name,
            storage_key=review_source.storage_key,
            filename=review_source.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            size_bytes=review_source.size_bytes,
        )
    )
    session.commit()
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.SOURCE,
        bytes_count=source.size_bytes,
        reason="seed_source",
        object_type="score_revision_source",
        object_id=source.source_uuid,
        storage_key=source.storage_key,
    )
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.UPLOAD,
        bytes_count=upload.size_bytes,
        reason="seed_upload",
        object_type="upload",
        object_id="origin-upload-sha",
        storage_key=upload.storage_key,
    )
    storage_usage_service.record_allocation_sync(
        session,
        user_id=1,
        category=StorageUsageCategory.TEMP_IMPORT,
        bytes_count=review_source.size_bytes,
        reason="seed_import_artifact",
        object_type="import_artifact",
        object_id="origin-review-source",
        storage_key=review_source.storage_key,
    )
    source_storage_key = source.storage_key
    upload_storage_key = upload.storage_key
    review_source_storage_key = review_source.storage_key

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
    storage_usage_session: tuple[Session, LocalFileStorage],
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
    session.add_all([
        job,
        StorageBlob(
            id=1303,
            blob_uuid="delete-owned-upload-blob",
            sha256="delete-owned-upload-sha",
            storage_backend=storage.backend_name,
            storage_key=upload.storage_key,
            filename=upload.filename,
            size_bytes=upload.size_bytes,
            mime_type="image/png",
        ),
        Upload(
            id=1002,
            blob_id=1303,
            original_filename="upload.png",
            uploader_user_id=1,
        ),
    ])
    session.commit()
    session.add(ImportJobUpload(job_id=1001, upload_id=1002, page_number=1, sort_order=1))
    session.add(
        ImportArtifact(
            artifact_uuid="delete-owned-review-source",
            job_id=1001,
            kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            storage_backend=storage.backend_name,
            storage_key=review_source.storage_key,
            filename=review_source.filename,
            mime_type="application/vnd.recordare.musicxml+xml",
            size_bytes=review_source.size_bytes,
        )
    )
    session.add(
        ImportArtifact(
            artifact_uuid="delete-owned-thumbnail",
            job_id=1001,
            kind=ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
            storage_backend=storage.backend_name,
            storage_key=thumbnail.storage_key,
            filename=thumbnail.filename,
            mime_type="image/png",
            size_bytes=thumbnail.size_bytes,
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
        object_id="delete-owned-upload-sha",
        storage_key=upload.storage_key,
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
    assert not storage.exists(upload.storage_key)
    assert not storage.exists(review_source.storage_key)
    assert not storage.exists(thumbnail.storage_key)
    assert not os.path.exists(storage.local_path(f"jobs/{job_uuid}"))
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
    storage_usage_session: tuple[Session, LocalFileStorage],
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
            StorageBlob(
                id=1304,
                blob_uuid="shared-upload-blob",
                sha256="shared-upload-sha",
                storage_backend=storage.backend_name,
                storage_key=upload.storage_key,
                filename=upload.filename,
                size_bytes=upload.size_bytes,
                mime_type="image/png",
            ),
            Upload(
                id=1103,
                blob_id=1304,
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
        object_id="shared-upload-sha",
        storage_key=upload.storage_key,
    )

    await ImportJobService(storage=storage).delete(
        AsyncSessionAdapter(session),
        "job-delete-shared-a",
        1,
    )

    assert session.get(ImportJob, 1101) is None
    assert session.get(ImportJob, 1102) is not None
    assert session.get(Upload, 1103) is not None
    assert storage.exists(upload.storage_key)
    account = session.get(StorageUsageAccount, 1)
    assert account is not None
    assert account.used_bytes == upload.size_bytes
