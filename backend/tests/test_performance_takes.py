from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import os
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4
import warnings

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, inspect, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app.api.deps import get_current_user, get_db
from app.db.models import (
    PerformanceTake,
    PerformanceTakeDeletionStatus,
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
    PerformanceTakeMediaKind,
    PerformanceTakeUploadAuthorization,
    PerformanceTakeUploadAuthorizationStatus,
    Score,
    ScoreRevision,
    StorageQuotaPolicy,
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    User,
)
from app.db.models.score import RevisionOrigin, ScoreDeletionStatus
from app.main import app
from app.modules.performance_takes.delete_outbox_service import (
    performance_take_delete_outbox_service,
)
from app.modules.performance_takes.dependencies import (
    get_performance_take_service,
)
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.scores.dependencies import get_score_service
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.modules.scores.service import ScoreService
from app.modules.storage_usage.dependencies import get_storage_usage_service
from app.modules.storage_usage.service import StorageUsageService
from app.storage.base import DirectUploadTarget
from app.storage.factory import get_file_storage
from app.storage.local import LocalFileStorage
from app.worker.execution import performance_take_deletion

VALID_WEBM_BYTES = b"\x1a\x45\xdf\xa3" + b"fake-webm-audio-binary-data-12345"
POSTGRES_TEST_ADMIN_URL_ENV = "NOTEVERSE_TEST_POSTGRES_ADMIN_URL"
POSTGRES_TEST_DB_PREFIX = "noteverse_test_perf_takes_"


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


@contextmanager
def _mock_worker_db(session: Session) -> Iterator[Session]:
    yield session


class _TraceScope:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *_args: object) -> None:
        return None


def _run_worker_deletion(
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
    storage: LocalFileStorage,
    outbox_uuid: str,
) -> dict[str, str]:
    monkeypatch.setattr(
        performance_take_deletion, "get_worker_db", lambda: _mock_worker_db(session)
    )
    monkeypatch.setattr(performance_take_deletion, "file_storage", storage)
    monkeypatch.setattr(
        performance_take_deletion, "start_attempt_trace", lambda **_kwargs: _TraceScope()
    )
    return performance_take_deletion.execute_performance_take_deletion_task(None, outbox_uuid)


@pytest.fixture
def test_env(tmp_path) -> Iterator[tuple[Session, LocalFileStorage, User, User]]:
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

    # Enable mock OSS direct upload target on storage
    def mock_upload_url(key: str, *, content_type: str, checksum_sha256: str = "") -> DirectUploadTarget:
        return DirectUploadTarget(
            upload_url=f"https://oss.example.com/{key}",
            upload_method="PUT",
            upload_headers={"content-type": content_type},
        )

    storage.upload_url = mock_upload_url  # type: ignore[assignment]

    with Session(engine) as session:
        user_1 = User(
            id=1,
            email="user1@example.com",
            display_name="User One",
            password_hash="hash1",
        )
        user_2 = User(
            id=2,
            email="user2@example.com",
            display_name="User Two",
            password_hash="hash2",
        )
        session.add(user_1)
        session.add(user_2)
        session.flush()

        policy = StorageQuotaPolicy(
            plan_code="FREE",
            quota_limit_bytes=100 * 1024 * 1024,  # 100MB
        )
        session.add(policy)

        account_1 = StorageUsageAccount(
            user_id=1,
            plan_code="FREE",
            quota_limit_bytes=100 * 1024 * 1024,
            used_bytes=0,
            reserved_bytes=0,
        )
        account_2 = StorageUsageAccount(
            user_id=2,
            plan_code="FREE",
            quota_limit_bytes=100 * 1024 * 1024,
            used_bytes=0,
            reserved_bytes=0,
        )
        session.add(account_1)
        session.add(account_2)

        counter_1 = StorageUsageCounter(
            user_id=1,
            category=StorageUsageCategory.UPLOAD,
            used_bytes=0,
            reserved_bytes=0,
        )
        counter_2 = StorageUsageCounter(
            user_id=2,
            category=StorageUsageCategory.UPLOAD,
            used_bytes=0,
            reserved_bytes=0,
        )
        session.add(counter_1)
        session.add(counter_2)

        score = Score(
            id=10,
            score_uuid="score-uuid-10",
            owner_user_id=1,
            title="Moonlight Sonata",
            deletion_status=ScoreDeletionStatus.ACTIVE,
        )
        session.add(score)
        session.flush()

        revision = ScoreRevision(
            id=100,
            revision_uuid="revision-uuid-100",
            score_id=10,
            revision_number=1,
            content_hash="abc123hash",
            origin=RevisionOrigin.OMR,
            created_by_user_id=1,
        )
        session.add(revision)
        session.flush()

        score.head_revision_id = 100
        session.flush()

        session.commit()
        yield session, storage, user_1, user_2


def test_unauthenticated_access_denied():
    client = TestClient(app)

    r1 = client.post("/api/v1/performance-takes/upload-authorizations", json={})
    assert r1.status_code == 401

    r2 = client.post("/api/v1/performance-takes", json={})
    assert r2.status_code == 401

    r3 = client.get("/api/v1/performance-takes")
    assert r3.status_code == 401

    r4 = client.get("/api/v1/performance-takes/some-uuid")
    assert r4.status_code == 401

    r5 = client.get("/api/v1/performance-takes/some-uuid/playback-url")
    assert r5.status_code == 401

    r6 = client.delete("/api/v1/performance-takes/some-uuid")
    assert r6.status_code == 401


def test_take_lifecycle_direct_oss_and_quota(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # 1. Authorize upload with external UUIDs
        media_content = VALID_WEBM_BYTES
        media_size = len(media_content)

        auth_req = {
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-100",
            "artifact_id": "art-1",
            "client_request_id": "req-001",
            "media_byte_size": media_size,
            "media_mime_type": "audio/webm",
            "duration_ms": 15000,
            "scope_type": "FULL",
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 16.0,
            "tempo_selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 120},
            "resolved_tempo_plan": {"selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 120}, "segments": [{"startBeat": 0, "bpm": 120}]},
            "sync_metadata": {"recordingTimebase": {"activeSegments": []}},
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res.status_code == 200, res.text
        auth_data = res.json()["data"]
        take_id = auth_data["take_id"]
        reservation_id = auth_data["reservation_id"]
        upload_url = auth_data["upload_url"]
        staging_object_key = auth_data["object_key"]
        assert take_id
        assert reservation_id
        assert upload_url.startswith("https://oss.example.com/")
        assert staging_object_key.startswith("staging/performance-takes/")

        # Verify quota reservation was held
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == media_size
        assert account.used_bytes == 0

        # 2. Finalize fails before upload to storage; reservation is preserved for retry
        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-001",
            "reservation_id": reservation_id,
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-100",
            "artifact_id": "art-1",
            "media_byte_size": media_size,
            "media_mime_type": "audio/webm",
            "duration_ms": 15000,
            "scope_type": "FULL",
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 16.0,
        }
        res_fail = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fail.status_code == 404

        # Quota reservation is preserved for safe retry
        session.refresh(account)
        assert account.reserved_bytes == media_size

        # 3. Simulate client direct upload to staging storage object
        storage.put_bytes(key=staging_object_key, content=media_content, content_type="audio/webm")

        # 4. Finalize successfully with external UUIDs
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200, res_fin.text
        take_data = res_fin.json()["data"]
        assert take_data["take_id"] == take_id
        assert take_data["score_id"] == "score-uuid-10"
        assert take_data["revision_id"] == "revision-uuid-100"
        assert take_data["score_title"] == "Moonlight Sonata"
        assert take_data["scope_type"] == "FULL"
        assert take_data["media_byte_size"] == media_size
        assert take_data["deletion_status"] == "ACTIVE"

        # Staging key cleaned, final key promoted
        final_object_key = f"performance-takes/1/{take_id}/recording.webm"
        assert not storage.exists(staging_object_key)
        assert storage.exists(final_object_key)

        # Quota should now be committed
        session.refresh(account)
        assert account.reserved_bytes == 0
        assert account.used_bytes == media_size

        # 6. Idempotency: retry finalize with same client_request_id
        res_idempotent = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_idempotent.status_code == 200
        assert res_idempotent.json()["data"]["take_id"] == take_id
        assert res_idempotent.json()["data"]["score_id"] == "score-uuid-10"

        # 7. List takes
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        items = res_list.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["take_id"] == take_id
        assert items[0]["score_id"] == "score-uuid-10"
        assert items[0]["score_title"] == "Moonlight Sonata"

        # 8. Get take detail
        res_detail = client.get(f"/api/v1/performance-takes/{take_id}")
        assert res_detail.status_code == 200
        assert res_detail.json()["data"]["take_id"] == take_id
        assert res_detail.json()["data"]["score_id"] == "score-uuid-10"

        # 9. Get playback URL
        res_play = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play.status_code == 200
        play_data = res_play.json()["data"]
        assert "playback_url" in play_data
        assert "download_url" in play_data

        # 10. Delete take (P0-2 returns 202 Accepted, marks DELETING, writes outbox)
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 202
        assert res_del.json()["data"]["status"] == "deleting"
        assert res_del.json()["data"]["take_id"] == take_id

        # Verify take is DELETING
        res_deleting = client.get(f"/api/v1/performance-takes/{take_id}")
        assert res_deleting.status_code == 200
        assert res_deleting.json()["data"]["deletion_status"] == "DELETING"

        # Verify playback URL returns 404 while DELETING
        res_play_deleting = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_deleting.status_code == 404

        # Repeated delete returns 202 idempotently
        res_del_repeat = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del_repeat.status_code == 202
        assert res_del_repeat.json()["data"]["status"] == "deleting"

        # Execute worker outbox deletion task
        outbox = session.execute(
            select(PerformanceTakeDeleteOutbox).where(
                PerformanceTakeDeleteOutbox.take_uuid == take_id
            )
        ).scalar_one()
        worker_res = _run_worker_deletion(monkeypatch, session, storage, outbox.outbox_uuid)
        assert worker_res["status"] == "deleted"

        # Verify take is gone after worker completes
        res_after_del = client.get(f"/api/v1/performance-takes/{take_id}")
        assert res_after_del.status_code == 404

        # Verify quota is released
        session.refresh(account)
        assert account.used_bytes == 0
        assert not storage.exists(final_object_key)

        # Deleting nonexistent take returns 404
        res_del_after = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del_after.status_code == 404

    finally:
        app.dependency_overrides.clear()


def test_score_access_and_validation(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # Invalid mime type rejected
        req_bad_mime = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-bad-mime",
            "media_byte_size": 1024,
            "media_mime_type": "video/mp4",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=req_bad_mime)
        assert res.status_code == 422

        # Invalid beat scope (start >= terminal)
        req_bad_scope = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-bad-scope",
            "media_byte_size": 1024,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 4.0,
            "scope_terminal_beat": 4.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=req_bad_scope)
        assert res.status_code == 422

        # Nonexistent score UUID returns 404
        req_bad_score = {
            "score_id": "nonexistent-score-uuid",
            "client_request_id": "req-bad-score",
            "media_byte_size": 1024,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=req_bad_score)
        assert res.status_code == 404

    finally:
        app.dependency_overrides.clear()


def test_unrelated_revision_rejected(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # Create score 20 with revision 200
        score_2 = Score(
            id=20,
            score_uuid="score-uuid-20",
            owner_user_id=1,
            title="Fur Elise",
            deletion_status=ScoreDeletionStatus.ACTIVE,
        )
        session.add(score_2)
        session.flush()

        revision_2 = ScoreRevision(
            id=200,
            revision_uuid="revision-uuid-200",
            score_id=20,
            revision_number=1,
            content_hash="hash200",
            origin=RevisionOrigin.OMR,
            created_by_user_id=1,
        )
        session.add(revision_2)
        session.flush()
        score_2.head_revision_id = 200
        session.commit()

        # Try to authorize with score-uuid-10 and unrelated revision-uuid-200
        req_unrelated = {
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-200",
            "client_request_id": "req-unrelated-rev",
            "media_byte_size": 1024,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=req_unrelated)
        assert res.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_cross_user_score_permission(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # User 2 owns a private score
        score_user2 = Score(
            id=30,
            score_uuid="score-uuid-user2",
            owner_user_id=2,
            title="User 2 Private Sonata",
            deletion_status=ScoreDeletionStatus.ACTIVE,
        )
        session.add(score_user2)
        session.flush()

        rev_user2 = ScoreRevision(
            id=300,
            revision_uuid="revision-uuid-user2",
            score_id=30,
            revision_number=1,
            content_hash="hash300",
            origin=RevisionOrigin.OMR,
            created_by_user_id=2,
        )
        session.add(rev_user2)
        session.flush()
        score_user2.head_revision_id = 300
        session.commit()

        # User 1 cannot authorize upload on User 2's private score
        app.dependency_overrides[get_current_user] = lambda: user_1
        req_unauth = {
            "score_id": "score-uuid-user2",
            "client_request_id": "req-cross-user-auth",
            "media_byte_size": 1024,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=req_unauth)
        assert res.status_code in (403, 404)
    finally:
        app.dependency_overrides.clear()


def test_real_soft_delete_and_real_cleanup_hard_delete(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )
    lifecycle_svc = ScoreLifecycleService(storage=storage)

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # 1. Create a take on score 10
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-100",
            "client_request_id": "req-real-delete-01",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 10000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 8.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        staging_key = auth_data["object_key"]
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-real-delete-01",
            "reservation_id": res_id,
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-100",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 10000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 8.0,
        }
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200
        assert res_fin.json()["data"]["score_title"] == "Moonlight Sonata"

        final_key = f"performance-takes/1/{take_id}/recording.webm"
        assert storage.exists(final_key)

        # Initial list check: score is active, so score_id is returned
        res_init_list = client.get("/api/v1/performance-takes")
        assert res_init_list.status_code == 200
        assert res_init_list.json()["data"]["items"][0]["score_id"] == "score-uuid-10"

        # 2. REAL SOFT DELETE: invoke real ScoreService.batch_delete / HTTP POST /api/v1/scores/batch-delete
        score_svc = ScoreService(storage=storage)
        app.dependency_overrides[get_score_service] = lambda: score_svc

        res_soft = client.post("/api/v1/scores/batch-delete", json={"score_ids": ["score-uuid-10"]})
        assert res_soft.status_code == 200
        assert res_soft.json()["data"]["removed"] == 1

        score_row = session.execute(select(Score).where(Score.id == 10)).scalar_one()
        assert score_row.deletion_status == ScoreDeletionStatus.DELETING

        # Listing takes: score is DELETING, so score_id is None, score_title snapshot preserved
        res_list_soft = client.get("/api/v1/performance-takes")
        assert res_list_soft.status_code == 200
        item_soft = res_list_soft.json()["data"]["items"][0]
        assert item_soft["take_id"] == take_id
        assert item_soft["score_id"] is None
        assert item_soft["score_title"] == "Moonlight Sonata"

        # Playback still works during soft delete
        res_play_soft = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_soft.status_code == 200

        # User's storage quota still accounts for take audio
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == size

        # 3. REAL HARD CLEANUP: invoke cleanup_deleting_scores
        cleanup_res = lifecycle_svc.cleanup_deleting_scores(session)
        assert cleanup_res.scores_deleted == 1

        # Verify in DB: score is deleted
        assert session.execute(select(Score).where(Score.id == 10)).scalar_one_or_none() is None

        # Verify in DB: take row is preserved with score_id=None, revision_id=None, score_title="Moonlight Sonata"
        take_in_db = session.execute(select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)).scalar_one_or_none()
        assert take_in_db is not None
        assert take_in_db.score_id is None
        assert take_in_db.revision_id is None
        assert take_in_db.score_title == "Moonlight Sonata"

        # Verify storage: media object is STILL PRESERVED!
        assert storage.exists(final_key)

        # Verify storage quota: user quota is STILL PRESERVED!
        session.refresh(account)
        assert account.used_bytes == size

        # Listing takes after hard delete: score_id is None, score_title preserved
        res_list_hard = client.get("/api/v1/performance-takes")
        assert res_list_hard.status_code == 200
        item_hard = res_list_hard.json()["data"]["items"][0]
        assert item_hard["take_id"] == take_id
        assert item_hard["score_id"] is None
        assert item_hard["score_title"] == "Moonlight Sonata"

        # Playback and download still work after score hard delete
        res_play_hard = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_hard.status_code == 200
        assert "download_url" in res_play_hard.json()["data"]

        # Deleting take returns 202 Accepted
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 202

        # Run worker to complete deletion
        outbox = session.execute(
            select(PerformanceTakeDeleteOutbox).where(
                PerformanceTakeDeleteOutbox.take_uuid == take_id
            )
        ).scalar_one()
        worker_res = _run_worker_deletion(monkeypatch, session, storage, outbox.outbox_uuid)
        assert worker_res["status"] == "deleted"

        assert not storage.exists(final_key)
        session.refresh(account)
        assert account.used_bytes == 0

    finally:
        app.dependency_overrides.clear()


def test_duplicate_deletion_idempotency(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-idemp-del",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        take_id = res_auth.json()["data"]["take_id"]
        res_id = res_auth.json()["data"]["reservation_id"]
        staging_key = res_auth.json()["data"]["object_key"]
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-idemp-del",
            "reservation_id": res_id,
            "score_id": "score-uuid-10",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200

        # First delete succeeds and returns 202
        res_del1 = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del1.status_code == 202

        # Second delete while DELETING returns 202 idempotently
        res_del2 = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del2.status_code == 202

        # Exactly 1 outbox record in DB
        outboxes = session.execute(
            select(PerformanceTakeDeleteOutbox).where(
                PerformanceTakeDeleteOutbox.take_uuid == take_id
            )
        ).scalars().all()
        assert len(outboxes) == 1

        # Run worker deletion
        worker_res = _run_worker_deletion(monkeypatch, session, storage, outboxes[0].outbox_uuid)
        assert worker_res["status"] == "deleted"

        # Account used_bytes is 0
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == 0

        # Third delete returns 404, does NOT double-release quota
        res_del3 = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del3.status_code == 404

        session.refresh(account)
        assert account.used_bytes == 0  # not negative!

    finally:
        app.dependency_overrides.clear()


def test_quota_rejection(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        excessive_size = 150 * 1024 * 1024
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-huge",
            "media_byte_size": excessive_size,
            "media_mime_type": "audio/webm",
            "duration_ms": 60000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 16.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res.status_code == 422
        assert res.json()["public_code"] == "storage_quota_exceeded"
    finally:
        app.dependency_overrides.clear()


def test_cancel_upload_authorization(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-cancel-01",
            "media_byte_size": 5000,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_auth.status_code == 200
        res_id = res_auth.json()["data"]["reservation_id"]
        staging_key = res_auth.json()["data"]["object_key"]
        storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == 5000

        # Cancel authorization via DELETE route
        res_cancel = client.delete(f"/api/v1/performance-takes/upload-authorizations/{res_id}")
        assert res_cancel.status_code == 200
        assert res_cancel.json()["data"]["cancelled"] is True

        session.refresh(account)
        assert account.reserved_bytes == 0
        assert not storage.exists(staging_key)

        # Idempotent cancel via legacy POST /cancel route
        res_cancel_post = client.post(f"/api/v1/performance-takes/upload-authorizations/{res_id}/cancel")
        assert res_cancel_post.status_code == 200
        assert res_cancel_post.json()["data"]["cancelled"] is True

    finally:
        app.dependency_overrides.clear()


def test_pagination(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # Create 3 takes for User 1 with valid container bytes
        for i in range(1, 4):
            content = VALID_WEBM_BYTES + f"-take-{i}".encode()
            size = len(content)
            auth_req = {
                "score_id": "score-uuid-10",
                "client_request_id": f"req-page-{i}",
                "media_byte_size": size,
                "media_mime_type": "audio/webm",
                "duration_ms": 5000,
                "scope_start_beat": 0.0,
                "scope_terminal_beat": 4.0,
            }
            res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
            assert res_auth.status_code == 200
            data = res_auth.json()["data"]
            take_id = data["take_id"]
            res_id = data["reservation_id"]
            storage.put_bytes(key=data["object_key"], content=content, content_type="audio/webm")

            fin_req = {
                "take_id": take_id,
                "client_request_id": f"req-page-{i}",
                "reservation_id": res_id,
                "score_id": "score-uuid-10",
                "media_byte_size": size,
                "media_mime_type": "audio/webm",
                "duration_ms": 5000,
                "scope_start_beat": 0.0,
                "scope_terminal_beat": 4.0,
            }
            res_fin = client.post("/api/v1/performance-takes", json=fin_req)
            assert res_fin.status_code == 200

        # Page 1: limit=2, offset=0
        r1 = client.get("/api/v1/performance-takes?limit=2&offset=0")
        assert r1.status_code == 200
        d1 = r1.json()["data"]
        assert len(d1["items"]) == 2
        assert d1["total"] == 3
        assert d1["has_more"] is True

        # Page 2: limit=2, offset=2
        r2 = client.get("/api/v1/performance-takes?limit=2&offset=2")
        assert r2.status_code == 200
        d2 = r2.json()["data"]
        assert len(d2["items"]) == 1
        assert d2["total"] == 3
        assert d2["has_more"] is False

    finally:
        app.dependency_overrides.clear()


def test_audio_container_magic_bytes_validation(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # 1. Invalid container header rejected with 422 media_mime_type
        bad_content = b"INVALID_MAGIC_BYTES_1234567890"
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-bad-magic",
            "media_byte_size": len(bad_content),
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        staging_key = auth_data["object_key"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(key=staging_key, content=bad_content, content_type="audio/webm")

        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-bad-magic",
            "reservation_id": res_id,
            "score_id": "score-uuid-10",
            "media_byte_size": len(bad_content),
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_fin_bad = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin_bad.status_code == 422
        assert res_fin_bad.json()["public_code"] == "validation_error"
        # Final immutable object was NEVER created
        final_key = f"performance-takes/1/{take_id}/recording.webm"
        assert not storage.exists(final_key)

        # 2. Valid OGG container: b"OggS..."
        ogg_content = b"OggS" + b"\x00" * 40
        auth_ogg = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-ogg-magic",
            "media_byte_size": len(ogg_content),
            "media_mime_type": "audio/ogg",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth_ogg = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_ogg)
        assert res_auth_ogg.status_code == 200
        ogg_auth_data = res_auth_ogg.json()["data"]
        storage.put_bytes(key=ogg_auth_data["object_key"], content=ogg_content, content_type="audio/ogg")
        fin_ogg = {
            "take_id": ogg_auth_data["take_id"],
            "client_request_id": "req-ogg-magic",
            "reservation_id": ogg_auth_data["reservation_id"],
            "score_id": "score-uuid-10",
            "media_byte_size": len(ogg_content),
            "media_mime_type": "audio/ogg",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_fin_ogg = client.post("/api/v1/performance-takes", json=fin_ogg)
        assert res_fin_ogg.status_code == 200

        # 3. Valid WAV container: b"RIFF....WAVE..."
        wav_content = b"RIFF" + b"\x24\x00\x00\x00" + b"WAVEfmt " + b"\x00" * 32
        auth_wav = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-wav-magic",
            "media_byte_size": len(wav_content),
            "media_mime_type": "audio/wav",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth_wav = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_wav)
        assert res_auth_wav.status_code == 200
        wav_auth_data = res_auth_wav.json()["data"]
        storage.put_bytes(key=wav_auth_data["object_key"], content=wav_content, content_type="audio/wav")
        fin_wav = {
            "take_id": wav_auth_data["take_id"],
            "client_request_id": "req-wav-magic",
            "reservation_id": wav_auth_data["reservation_id"],
            "score_id": "score-uuid-10",
            "media_byte_size": len(wav_content),
            "media_mime_type": "audio/wav",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_fin_wav = client.post("/api/v1/performance-takes", json=fin_wav)
        assert res_fin_wav.status_code == 200

    finally:
        app.dependency_overrides.clear()


def test_finalize_safe_retry_idempotency(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-safe-retry-01",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(key=auth_data["object_key"], content=content, content_type="audio/webm")

        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-safe-retry-01",
            "reservation_id": res_id,
            "score_id": "score-uuid-10",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        # First finalize
        res_fin_1 = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin_1.status_code == 200
        take_1 = res_fin_1.json()["data"]

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == size

        # Client timeout / network error retry finalize with identical client_request_id
        res_fin_2 = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin_2.status_code == 200
        take_2 = res_fin_2.json()["data"]
        assert take_2["take_id"] == take_1["take_id"]

        # Quota used_bytes must NOT be doubled
        session.refresh(account)
        assert account.used_bytes == size

        # Exactly 1 take row exists in DB
        takes = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalars().all()
        assert len(takes) == 1

    finally:
        app.dependency_overrides.clear()


def test_crash_abandoned_after_authorization(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-abandoned-01",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        staging_key = auth_data["object_key"]
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == size

        # Simulate time passing and authorization expiring
        auth = session.execute(
            select(PerformanceTakeUploadAuthorization).where(
                PerformanceTakeUploadAuthorization.client_request_id == "req-abandoned-01"
            )
        ).scalar_one()
        auth.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
        session.commit()

        # Background maintenance task cleans expired authorizations
        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_authorizations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()
        assert cleaned_count == 1

        # Staging file is deleted, quota reservation released
        assert not storage.exists(staging_key)
        session.refresh(account)
        assert account.reserved_bytes == 0

        session.refresh(auth)
        assert auth.status == PerformanceTakeUploadAuthorizationStatus.EXPIRED

    finally:
        app.dependency_overrides.clear()


def test_score_deleted_between_auth_and_finalize(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-100",
            "client_request_id": "req-score-del-midway",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        staging_key = auth_data["object_key"]
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        # Simulate score being hard-deleted before client calls finalize
        session.execute(text("UPDATE scores SET head_revision_id = NULL WHERE id = 10;"))
        session.execute(text("DELETE FROM score_revisions WHERE score_id = 10;"))
        session.execute(text("DELETE FROM scores WHERE id = 10;"))
        session.commit()

        # Client finalizes
        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-score-del-midway",
            "reservation_id": res_id,
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-100",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200
        take_data = res_fin.json()["data"]
        # Score and revision are cleared, snapshot title is preserved
        assert take_data["score_id"] is None
        assert take_data["revision_id"] is None
        assert take_data["score_title"] == "Moonlight Sonata"

        # List takes returns the take with score_id=None
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        item = res_list.json()["data"]["items"][0]
        assert item["take_id"] == take_id
        assert item["score_id"] is None
        assert item["score_title"] == "Moonlight Sonata"

    finally:
        app.dependency_overrides.clear()


def test_deletion_lifecycle_and_worker_retry(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-del-retry",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(key=auth_data["object_key"], content=content, content_type="audio/webm")

        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-del-retry",
            "reservation_id": res_id,
            "score_id": "score-uuid-10",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200

        # Request deletion -> 202 Accepted
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 202

        outbox = session.execute(
            select(PerformanceTakeDeleteOutbox).where(
                PerformanceTakeDeleteOutbox.take_uuid == take_id
            )
        ).scalar_one()
        assert outbox.status == PerformanceTakeDeleteOutboxStatus.PENDING
        assert outbox.attempt_count == 0

        # 1. Simulate worker failure: storage raises connection error
        class FailingStorage(LocalFileStorage):
            def delete(self, key: str) -> None:
                raise ConnectionError("Transient OSS deletion timeout")

        failing_storage = FailingStorage(storage_root=storage.storage_root)
        failing_res = _run_worker_deletion(monkeypatch, session, failing_storage, outbox.outbox_uuid)
        assert failing_res["status"] == "failed"

        # Outbox marked FAILED with backoff retry
        session.refresh(outbox)
        assert outbox.status == PerformanceTakeDeleteOutboxStatus.FAILED
        assert outbox.attempt_count == 1
        assert "Transient OSS deletion timeout" in (outbox.last_error or "")

        # Take is still in DB, quota still charged
        take_db = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one_or_none()
        assert take_db is not None
        assert take_db.deletion_status == PerformanceTakeDeletionStatus.DELETING
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == size

        # 2. Worker retry succeeds with healthy storage (advance next_attempt_at past delay)
        outbox.next_attempt_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
        session.commit()
        ok_res = _run_worker_deletion(monkeypatch, session, storage, outbox.outbox_uuid)
        assert ok_res["status"] == "deleted"

        # Outbox marked COMPLETED
        session.refresh(outbox)
        assert outbox.status == PerformanceTakeDeleteOutboxStatus.COMPLETED

        # Take deleted, quota released
        assert session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one_or_none() is None
        session.refresh(account)
        assert account.used_bytes == 0

    finally:
        app.dependency_overrides.clear()


def test_worker_oss_success_then_db_retry(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "score_id": "score-uuid-10",
            "client_request_id": "req-oss-idemp",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(key=auth_data["object_key"], content=content, content_type="audio/webm")

        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-oss-idemp",
            "reservation_id": res_id,
            "score_id": "score-uuid-10",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200

        final_key = f"performance-takes/1/{take_id}/recording.webm"
        assert storage.exists(final_key)

        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 202

        outbox = session.execute(
            select(PerformanceTakeDeleteOutbox).where(
                PerformanceTakeDeleteOutbox.take_uuid == take_id
            )
        ).scalar_one()

        # Simulate OSS file already removed on prior attempt before DB crashed
        storage.delete(final_key)
        assert not storage.exists(final_key)

        # Worker runs and handles absent file idempotently
        worker_res = _run_worker_deletion(monkeypatch, session, storage, outbox.outbox_uuid)
        assert worker_res["status"] == "deleted"

        session.refresh(outbox)
        assert outbox.status == PerformanceTakeDeleteOutboxStatus.COMPLETED

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == 0

    finally:
        app.dependency_overrides.clear()


def _normalise_psycopg_url(database_url: str) -> str:
    return (
        database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        .replace("postgresql+psycopg://", "postgresql://", 1)
    )


def _postgres_test_admin_url() -> str:
    admin_url = os.environ.get(POSTGRES_TEST_ADMIN_URL_ENV)
    if not admin_url:
        pytest.skip(
            f"PostgreSQL migration tests NOT VERIFIED: set {POSTGRES_TEST_ADMIN_URL_ENV} "
            "to an explicit disposable-test admin connection URL."
        )
    normalized = _normalise_psycopg_url(admin_url.strip())
    if not normalized.startswith("postgresql://"):
        pytest.skip(
            f"PostgreSQL migration tests NOT VERIFIED: {POSTGRES_TEST_ADMIN_URL_ENV} "
            "must use a PostgreSQL URL."
        )
    return normalized


def _postgres_url_for_database(admin_url: str, database_name: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    parsed = urlsplit(admin_url)
    return urlunsplit(parsed._replace(path=f"/{database_name}", query="", fragment=""))


@contextmanager
def _isolated_postgres_database() -> Iterator[tuple[str, str]]:
    """Create and later drop a uniquely named PostgreSQL database for this test."""

    import psycopg
    from psycopg import sql

    admin_url = _postgres_test_admin_url()
    database_name = f"{POSTGRES_TEST_DB_PREFIX}{uuid4().hex}"
    if not database_name.startswith(POSTGRES_TEST_DB_PREFIX):
        raise AssertionError(f"Unsafe PostgreSQL test database name: {database_name}")

    admin_conn = psycopg.connect(admin_url, autocommit=True, connect_timeout=3)
    created = False
    try:
        with admin_conn.cursor() as cur:
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
        created = True

        database_url = _postgres_url_for_database(admin_url, database_name)
        marker_conn = psycopg.connect(database_url, autocommit=True, connect_timeout=3)
        try:
            with marker_conn.cursor() as cur:
                cur.execute(
                    "CREATE TABLE noteverse_test_database_marker "
                    "(database_name TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
                )
                cur.execute(
                    "INSERT INTO noteverse_test_database_marker (database_name) VALUES (%s)",
                    (database_name,),
                )
        finally:
            marker_conn.close()

        yield database_name, database_url
    finally:
        if created:
            if not database_name.startswith(POSTGRES_TEST_DB_PREFIX):
                raise AssertionError(f"Refusing to drop unsafe database name: {database_name}")
            try:
                verify_conn = psycopg.connect(
                    _postgres_url_for_database(admin_url, database_name),
                    autocommit=True,
                    connect_timeout=3,
                )
                try:
                    with verify_conn.cursor() as cur:
                        cur.execute(
                            "SELECT 1 FROM noteverse_test_database_marker WHERE database_name = %s",
                            (database_name,),
                        )
                        if cur.fetchone() is None:
                            raise AssertionError(
                                f"Refusing to drop unmarked PostgreSQL test database: {database_name}"
                            )
                finally:
                    verify_conn.close()
            finally:
                with admin_conn.cursor() as cur:
                    cur.execute(
                        "SELECT pg_terminate_backend(pid) "
                        "FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
                        (database_name,),
                    )
                    cur.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database_name)))
        admin_conn.close()


def _alembic_config(database_url: str):
    from alembic.config import Config

    alembic_dir = str(Path(__file__).resolve().parents[1] / "alembic")
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", alembic_dir)
    cfg.set_main_option("sqlalchemy.url", database_url)
    return cfg


def test_constructed_0053_alembic_upgrade_to_0056_sqlite(tmp_path: Path):
    """Construct a 0053 SQLite state, then run the real 0054 -> 0056 migrations.

    Checks:
    - Real command.upgrade(cfg, '0056_take_auth_and_deletion_outbox') execution
    - score_id / revision_id nullability
    - score_title column added and safely backfilled
    - scope_type column added with default 'FULL'
    - deletion_status column added to performance_takes with default 'ACTIVE'
    - performance_take_upload_authorizations table created with all columns and indexes
    - performance_take_delete_outbox table created with all columns and indexes
    - FK ON DELETE SET NULL for scores and score_revisions
    - Exactly 1 uq_performance_takes_user_client_request_id (no duplicate unique constraints)
    - 0 SAWarnings emitted during migration
    - Under PRAGMA foreign_keys = ON, deleting the score sets score_id/revision_id to NULL,
      preserving take row and score_title snapshot.
    """
    from alembic import command
    import sqlalchemy as sa

    db_path = tmp_path / "test_migration_sqlite.db"
    sqlite_url = f"sqlite:///{db_path}"
    engine = create_engine(sqlite_url)

    # 1. Set up 0053 state
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE alembic_version (version_num VARCHAR(128) NOT NULL, PRIMARY KEY (version_num));"))
        conn.execute(sa.text("INSERT INTO alembic_version VALUES ('0053_performance_takes');"))
        conn.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255) NOT NULL);"))
        conn.execute(sa.text("INSERT INTO users VALUES (1, 'u1@test.com');"))
        conn.execute(sa.text("CREATE TABLE scores (id INTEGER PRIMARY KEY, title VARCHAR(255) NOT NULL);"))
        conn.execute(sa.text("INSERT INTO scores VALUES (10, 'Sonata Allegro');"))
        conn.execute(sa.text("CREATE TABLE score_revisions (id INTEGER PRIMARY KEY, score_id INTEGER NOT NULL REFERENCES scores(id) ON DELETE CASCADE);"))
        conn.execute(sa.text("INSERT INTO score_revisions VALUES (100, 10);"))
        # 0053 schema: score_id NOT NULL REFERENCES scores(id) ON DELETE CASCADE
        conn.execute(sa.text("""
        CREATE TABLE performance_takes (
            id INTEGER PRIMARY KEY,
            take_uuid VARCHAR(36) NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            score_id INTEGER NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
            revision_id INTEGER REFERENCES score_revisions(id) ON DELETE SET NULL,
            artifact_id VARCHAR(128),
            client_request_id VARCHAR(128) NOT NULL,
            media_kind VARCHAR(16) NOT NULL DEFAULT 'AUDIO',
            media_mime_type VARCHAR(64) NOT NULL,
            media_byte_size BIGINT NOT NULL,
            media_object_key VARCHAR(768) NOT NULL,
            storage_backend VARCHAR(32) NOT NULL,
            duration_ms INTEGER NOT NULL,
            scope_start_beat REAL NOT NULL,
            scope_terminal_beat REAL NOT NULL,
            tempo_selection TEXT,
            resolved_tempo_plan TEXT,
            sync_metadata TEXT,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            CONSTRAINT uq_performance_takes_user_client_request_id UNIQUE (user_id, client_request_id)
        );
        """))
        conn.execute(sa.text("CREATE UNIQUE INDEX ix_performance_takes_take_uuid ON performance_takes (take_uuid);"))
        conn.execute(sa.text("CREATE INDEX ix_performance_takes_user_id ON performance_takes (user_id);"))
        conn.execute(sa.text("CREATE INDEX ix_performance_takes_score_id ON performance_takes (score_id);"))
        conn.execute(sa.text("CREATE INDEX ix_performance_takes_revision_id ON performance_takes (revision_id);"))
        conn.execute(sa.text("CREATE INDEX ix_performance_takes_client_request_id ON performance_takes (client_request_id);"))
        conn.execute(sa.text("""
        INSERT INTO performance_takes (
            id, take_uuid, user_id, score_id, revision_id, artifact_id, client_request_id,
            media_kind, media_mime_type, media_byte_size, media_object_key, storage_backend,
            duration_ms, scope_start_beat, scope_terminal_beat, created_at, updated_at
        ) VALUES (
            1, 'take-sqlite-001', 1, 10, 100, 'art-1', 'req-1',
            'AUDIO', 'audio/webm', 2048, 'users/1/takes/take-sqlite-001.webm', 'local',
            90000, 0.0, 32.0, '2026-09-20 14:00:00', '2026-09-20 14:00:00'
        );
        """))
    engine.dispose()

    # 2. Run real Alembic upgrade to 0056
    cfg = _alembic_config(sqlite_url)

    with warnings.catch_warnings(record=True) as recorded_warnings:
        warnings.simplefilter("always")
        command.upgrade(cfg, "0056_take_auth_and_deletion_outbox")
        sa_warnings = [w for w in recorded_warnings if issubclass(w.category, sa.exc.SAWarning)]
        assert len(sa_warnings) == 0, f"Unexpected SAWarnings during SQLite upgrade: {sa_warnings}"

    # 3. Introspect schema and verify columns, constraints, and indexes
    engine2 = create_engine(sqlite_url)
    inspector = inspect(engine2)
    tables = set(inspector.get_table_names())
    assert "performance_take_upload_authorizations" in tables
    assert "performance_take_delete_outbox" in tables

    cols = {c["name"]: c for c in inspector.get_columns("performance_takes")}
    assert cols["score_id"]["nullable"] is True
    assert cols["revision_id"]["nullable"] is True
    assert "score_title" in cols
    assert cols["score_title"]["nullable"] is True
    assert "scope_type" in cols
    assert cols["scope_type"]["nullable"] is False
    assert "deletion_status" in cols
    assert cols["deletion_status"]["nullable"] is False

    auth_cols = {c["name"]: c for c in inspector.get_columns("performance_take_upload_authorizations")}
    assert "auth_uuid" in auth_cols
    assert "staging_object_key" in auth_cols
    assert "final_object_key" in auth_cols
    assert "status" in auth_cols

    outbox_cols = {c["name"]: c for c in inspector.get_columns("performance_take_delete_outbox")}
    assert "outbox_uuid" in outbox_cols
    assert "take_uuid" in outbox_cols
    assert "status" in outbox_cols
    assert "next_attempt_at" in outbox_cols

    # Check backfilled data
    with engine2.connect() as conn:
        row = conn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type, deletion_status FROM performance_takes WHERE id = 1")).fetchone()
        assert row is not None
        assert row[0] == 1
        assert row[1] == "take-sqlite-001"
        assert row[2] == 1
        assert row[3] == 10
        assert row[4] == 100
        assert row[5] == "Sonata Allegro"  # safely backfilled
        assert row[6] == "FULL"
        assert row[7] == "ACTIVE"

    # Check FKs: exactly 3 FKs, no duplicates
    fks = inspector.get_foreign_keys("performance_takes")
    assert len(fks) == 3, f"Expected 3 FKs, got {len(fks)}: {fks}"
    score_fk = next(f for f in fks if f["referred_table"] == "scores")
    assert score_fk["options"].get("ondelete") == "SET NULL"
    rev_fk = next(f for f in fks if f["referred_table"] == "score_revisions")
    assert rev_fk["options"].get("ondelete") == "SET NULL"
    user_fk = next(f for f in fks if f["referred_table"] == "users")
    assert user_fk["options"].get("ondelete") == "CASCADE"

    # Check indexes on performance_takes
    indexes = inspector.get_indexes("performance_takes")
    index_names = {idx["name"] for idx in indexes}
    expected_indexes = {
        "ix_performance_takes_take_uuid",
        "ix_performance_takes_user_id",
        "ix_performance_takes_score_id",
        "ix_performance_takes_revision_id",
        "ix_performance_takes_client_request_id",
        "ix_performance_takes_user_deletion_status",
    }
    assert expected_indexes.issubset(index_names), f"Missing indexes: {expected_indexes - index_names}"

    # Check unique constraint: exactly 1 unique constraint for (user_id, client_request_id)
    unique_constraints = inspector.get_unique_constraints("performance_takes")
    uq_names = [uc["name"] for uc in unique_constraints if "uq_performance_takes_user_client_request_id" in str(uc.get("name", ""))]
    assert len(uq_names) == 1, f"Expected 1 unique constraint, got: {unique_constraints}"

    # 4. Under PRAGMA foreign_keys = ON, verify DELETE FROM scores
    with engine2.begin() as conn:
        conn.execute(sa.text("PRAGMA foreign_keys = ON;"))
        conn.execute(sa.text("DELETE FROM scores WHERE id = 10;"))

    with engine2.connect() as conn:
        row2 = conn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type, deletion_status FROM performance_takes WHERE id = 1")).fetchone()
        assert row2 is not None
        assert row2[3] is None  # score_id SET NULL
        assert row2[4] is None  # revision_id SET NULL
        assert row2[5] == "Sonata Allegro"  # title preserved
        assert row2[6] == "FULL"
        assert row2[7] == "ACTIVE"

    engine2.dispose()


def _setup_constructed_0053_performance_takes_state_postgresql(database_url: str) -> None:
    import psycopg

    conn = psycopg.connect(database_url, autocommit=True, connect_timeout=3)
    try:
        with conn.cursor() as pcur:
            pcur.execute(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num));"
            )
            pcur.execute("INSERT INTO alembic_version VALUES ('0053_performance_takes');")
            pcur.execute("CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL);")
            pcur.execute("INSERT INTO users (id, email) VALUES (1, 'u1@example.com');")
            pcur.execute("CREATE TABLE scores (id BIGSERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL);")
            pcur.execute("INSERT INTO scores (id, title) VALUES (10, 'PG Sonata Allegro');")
            pcur.execute(
                "CREATE TABLE score_revisions "
                "(id BIGSERIAL PRIMARY KEY, score_id BIGINT NOT NULL REFERENCES scores(id) ON DELETE CASCADE);"
            )
            pcur.execute("INSERT INTO score_revisions (id, score_id) VALUES (100, 10);")
            pcur.execute(
                """
                CREATE TABLE performance_takes (
                    id BIGSERIAL PRIMARY KEY,
                    take_uuid VARCHAR(36) NOT NULL,
                    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    score_id BIGINT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
                    revision_id BIGINT REFERENCES score_revisions(id) ON DELETE SET NULL,
                    artifact_id VARCHAR(128),
                    client_request_id VARCHAR(128) NOT NULL,
                    media_kind VARCHAR(16) NOT NULL DEFAULT 'AUDIO',
                    media_mime_type VARCHAR(64) NOT NULL,
                    media_byte_size BIGINT NOT NULL,
                    media_object_key VARCHAR(768) NOT NULL,
                    storage_backend VARCHAR(32) NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    scope_start_beat REAL NOT NULL,
                    scope_terminal_beat REAL NOT NULL,
                    tempo_selection TEXT,
                    resolved_tempo_plan TEXT,
                    sync_metadata TEXT,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL,
                    CONSTRAINT uq_performance_takes_user_client_request_id UNIQUE (user_id, client_request_id)
                );
                """
            )
            pcur.execute("CREATE UNIQUE INDEX ix_performance_takes_take_uuid ON performance_takes (take_uuid);")
            pcur.execute("CREATE INDEX ix_performance_takes_user_id ON performance_takes (user_id);")
            pcur.execute("CREATE INDEX ix_performance_takes_score_id ON performance_takes (score_id);")
            pcur.execute("CREATE INDEX ix_performance_takes_revision_id ON performance_takes (revision_id);")
            pcur.execute("CREATE INDEX ix_performance_takes_client_request_id ON performance_takes (client_request_id);")
            pcur.execute(
                """
                INSERT INTO performance_takes (
                    id, take_uuid, user_id, score_id, revision_id, artifact_id, client_request_id,
                    media_kind, media_mime_type, media_byte_size, media_object_key, storage_backend,
                    duration_ms, scope_start_beat, scope_terminal_beat, created_at, updated_at
                ) VALUES (
                    1, 'take-pg-001', 1, 10, 100, 'art-1', 'req-1',
                    'AUDIO', 'audio/webm', 2048, 'users/1/takes/take-pg-001.webm', 's3',
                    90000, 0.0, 32.0, '2026-09-20 14:00:00', '2026-09-20 14:00:00'
                );
                """
            )
    finally:
        conn.close()


def _assert_performance_take_upgrade_state(database_url: str) -> None:
    from alembic import command
    import sqlalchemy as sa

    command.upgrade(_alembic_config(database_url), "0056_take_auth_and_deletion_outbox")
    engine_pg = create_engine(database_url.replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        inspector = inspect(engine_pg)
        tables = set(inspector.get_table_names())
        assert "performance_take_upload_authorizations" in tables
        assert "performance_take_delete_outbox" in tables
        version_cols = {c["name"]: c for c in inspector.get_columns("alembic_version")}
        assert getattr(version_cols["version_num"]["type"], "length", None) == 128

        cols = {c["name"]: c for c in inspector.get_columns("performance_takes")}
        assert cols["score_id"]["nullable"] is True
        assert cols["revision_id"]["nullable"] is True
        assert "score_title" in cols
        assert cols["score_title"]["nullable"] is True
        assert "scope_type" in cols
        assert cols["scope_type"]["nullable"] is False
        assert "deletion_status" in cols
        assert cols["deletion_status"]["nullable"] is False

        fks = inspector.get_foreign_keys("performance_takes")
        assert len([fk for fk in fks if fk["referred_table"] == "scores"]) == 1
        score_fk = next(f for f in fks if f["referred_table"] == "scores")
        assert score_fk["options"].get("ondelete") == "SET NULL"
        rev_fk = next(f for f in fks if f["referred_table"] == "score_revisions")
        assert rev_fk["options"].get("ondelete") == "SET NULL"
        user_fk = next(f for f in fks if f["referred_table"] == "users")
        assert user_fk["options"].get("ondelete") == "CASCADE"

        indexes = {idx["name"] for idx in inspector.get_indexes("performance_takes")}
        assert {
            "ix_performance_takes_take_uuid",
            "ix_performance_takes_user_id",
            "ix_performance_takes_score_id",
            "ix_performance_takes_revision_id",
            "ix_performance_takes_client_request_id",
            "ix_performance_takes_user_deletion_status",
        }.issubset(indexes)

        unique_constraints = inspector.get_unique_constraints("performance_takes")
        uq_names = [
            uc["name"]
            for uc in unique_constraints
            if "uq_performance_takes_user_client_request_id" in str(uc.get("name", ""))
        ]
        assert len(uq_names) == 1, f"Expected 1 unique constraint, got: {unique_constraints}"

        with engine_pg.connect() as pconn:
            row = pconn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type, deletion_status FROM performance_takes WHERE id = 1")).fetchone()
            assert row is not None
            assert row[0] == 1
            assert row[1] == "take-pg-001"
            assert row[2] == 1
            assert row[3] == 10
            assert row[4] == 100
            assert row[5] == "PG Sonata Allegro"
            assert row[6] == "FULL"
            assert row[7] == "ACTIVE"

            # DELETE FROM scores on PG
            pconn.execute(sa.text("DELETE FROM scores WHERE id = 10;"))
            pconn.commit()

            row_after = pconn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type, deletion_status FROM performance_takes WHERE id = 1")).fetchone()
            assert row_after is not None
            assert row_after[3] is None  # score_id SET NULL
            assert row_after[4] is None  # revision_id SET NULL
            assert row_after[5] == "PG Sonata Allegro"  # title preserved
            assert row_after[6] == "FULL"
            assert row_after[7] == "ACTIVE"
    finally:
        engine_pg.dispose()


def test_empty_postgresql_database_initializes_with_wide_alembic_version_table():
    """Run the real migration chain from an empty isolated PostgreSQL database."""

    from alembic import command

    with _isolated_postgres_database() as (_database_name, database_url):
        command.upgrade(_alembic_config(database_url), "0056_take_auth_and_deletion_outbox")
        engine_pg = create_engine(database_url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            inspector = inspect(engine_pg)
            version_cols = {c["name"]: c for c in inspector.get_columns("alembic_version")}
            assert getattr(version_cols["version_num"]["type"], "length", None) == 128
            assert "performance_takes" in inspector.get_table_names()
        finally:
            engine_pg.dispose()


def test_constructed_0053_alembic_upgrade_to_0056_postgresql_short_version_table():
    """Construct a 0053 PostgreSQL state with VARCHAR(32), then run real 0054 -> 0056."""

    with _isolated_postgres_database() as (_database_name, database_url):
        _setup_constructed_0053_performance_takes_state_postgresql(database_url)
        _assert_performance_take_upgrade_state(database_url)


def test_constructed_0053_alembic_upgrade_to_0056_postgresql_long_version_table():
    """Construct a 0053 PostgreSQL state with pre-widened version table and upgrade."""

    import psycopg

    with _isolated_postgres_database() as (_database_name, database_url):
        _setup_constructed_0053_performance_takes_state_postgresql(database_url)
        conn = psycopg.connect(database_url, autocommit=True, connect_timeout=3)
        try:
            with conn.cursor() as cur:
                cur.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)")
        finally:
            conn.close()
        _assert_performance_take_upgrade_state(database_url)


def test_postgresql_version_table_widening_permission_error_is_not_swallowed():
    """A permission failure while widening alembic_version must abort before migrations."""

    import psycopg
    from psycopg import sql
    from alembic import command
    from sqlalchemy.exc import DBAPIError
    from urllib.parse import quote, urlsplit, urlunsplit

    restricted_user = os.environ.get("NOTEVERSE_TEST_POSTGRES_RESTRICTED_USER")
    restricted_password = os.environ.get("NOTEVERSE_TEST_POSTGRES_RESTRICTED_PASSWORD")
    if not restricted_user or not restricted_password:
        pytest.skip(
            "PostgreSQL insufficient-permission migration test NOT VERIFIED: set "
            "NOTEVERSE_TEST_POSTGRES_RESTRICTED_USER and "
            "NOTEVERSE_TEST_POSTGRES_RESTRICTED_PASSWORD."
        )

    with _isolated_postgres_database() as (_database_name, database_url):
        conn = psycopg.connect(database_url, autocommit=True, connect_timeout=3)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL, "
                    "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num));"
                )
                cur.execute("INSERT INTO alembic_version VALUES ('0053_performance_takes');")
                cur.execute("REVOKE ALL ON TABLE alembic_version FROM PUBLIC")
                cur.execute(
                    sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(
                        sql.Identifier(restricted_user)
                    )
                )
                cur.execute(
                    sql.SQL("GRANT SELECT ON TABLE alembic_version TO {}").format(
                        sql.Identifier(restricted_user)
                    )
                )
        finally:
            conn.close()

        parsed = urlsplit(database_url)
        host = parsed.hostname or "localhost"
        netloc = f"{quote(restricted_user)}:{quote(restricted_password)}@{host}"
        if parsed.port is not None:
            netloc = f"{netloc}:{parsed.port}"
        restricted_url = urlunsplit(parsed._replace(netloc=netloc))
        with pytest.raises((DBAPIError, PermissionError, RuntimeError)):
            command.upgrade(_alembic_config(restricted_url), "0056_take_auth_and_deletion_outbox")
