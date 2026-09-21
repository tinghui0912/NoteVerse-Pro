from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
import urllib.parse
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
    PerformanceTakeMediaKind,
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


def test_take_lifecycle_direct_oss_and_quota(test_env):
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
        media_content = b"fake-webm-audio-binary-data-12345"
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
        object_key = auth_data["object_key"]
        assert take_id
        assert reservation_id
        assert upload_url.startswith("https://oss.example.com/")

        # Verify quota reservation was held
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == media_size
        assert account.used_bytes == 0

        # 2. Finalize fails before upload to storage and auto-releases quota reservation
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

        # Quota reservation is auto-released on missing storage object
        session.refresh(account)
        assert account.reserved_bytes == 0

        # 3. Re-authorize for successful upload
        res_real = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_real.status_code == 200
        auth_data_real = res_real.json()["data"]
        take_id = auth_data_real["take_id"]
        reservation_id = auth_data_real["reservation_id"]
        object_key = auth_data_real["object_key"]

        # Simulate client direct upload to storage object
        storage.put_bytes(key=object_key, content=media_content, content_type="audio/webm")

        # 4. Finalize successfully with external UUIDs
        fin_req["take_id"] = take_id
        fin_req["reservation_id"] = reservation_id
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200, res_fin.text
        take_data = res_fin.json()["data"]
        assert take_data["take_id"] == take_id
        assert take_data["score_id"] == "score-uuid-10"
        assert take_data["revision_id"] == "revision-uuid-100"
        assert take_data["score_title"] == "Moonlight Sonata"
        assert take_data["scope_type"] == "FULL"
        assert take_data["media_byte_size"] == media_size

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

        # 10. Delete take
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 200
        assert res_del.json()["data"]["deleted"] is True

        # Verify take is gone
        res_after_del = client.get(f"/api/v1/performance-takes/{take_id}")
        assert res_after_del.status_code == 404

        # Verify quota is released
        session.refresh(account)
        assert account.used_bytes == 0
        assert not storage.exists(object_key)

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


def test_real_soft_delete_and_real_cleanup_hard_delete(test_env):
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
        content = b"audio-data-independence-real"
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
        key = auth_data["object_key"]
        storage.put_bytes(key=key, content=content, content_type="audio/webm")

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
        assert storage.exists(key)

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

        # Deleting take removes media and releases quota
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 200
        assert not storage.exists(key)

        session.refresh(account)
        assert account.used_bytes == 0

    finally:
        app.dependency_overrides.clear()


def test_duplicate_deletion_idempotency(test_env):
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
        content = b"audio-data-idempotency"
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
        key = res_auth.json()["data"]["object_key"]
        storage.put_bytes(key=key, content=content, content_type="audio/webm")

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
        client.post("/api/v1/performance-takes", json=fin_req)

        # First delete succeeds
        res_del1 = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del1.status_code == 200

        # Account used_bytes is 0
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == 0

        # Second delete returns 404, does NOT double-release quota
        res_del2 = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del2.status_code == 404

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

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == 5000

        # Cancel authorization
        res_cancel = client.post(f"/api/v1/performance-takes/upload-authorizations/{res_id}/cancel")
        assert res_cancel.status_code == 200
        assert res_cancel.json()["data"]["cancelled"] is True

        session.refresh(account)
        assert account.reserved_bytes == 0
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
        # Create 3 takes for User 1
        for i in range(1, 4):
            content = f"audio-{i}".encode()
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
            client.post("/api/v1/performance-takes", json=fin_req)

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


def test_real_alembic_upgrade_chain_sqlite(tmp_path: Path):
    """Verify real Alembic upgrade from 0053 -> 0054 -> 0055 on SQLite.

    Checks:
    - Real command.upgrade(cfg, '0055_performance_take_fk_and_scope_fix') execution
    - score_id / revision_id nullability
    - score_title column added and safely backfilled
    - scope_type column added with default 'FULL'
    - FK ON DELETE SET NULL for scores and score_revisions
    - Exactly 1 uq_performance_takes_user_client_request_id (no duplicate unique constraints)
    - No duplicate foreign keys
    - 0 SAWarnings emitted during migration
    - All 5 performance_takes indexes present
    - Under PRAGMA foreign_keys = ON, deleting the score sets score_id/revision_id to NULL,
      preserving take row and score_title snapshot.
    """
    from alembic import command
    from alembic.config import Config
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

    # 2. Run real Alembic upgrade
    alembic_dir = str(Path(__file__).resolve().parents[1] / "alembic")
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", alembic_dir)
    cfg.set_main_option("sqlalchemy.url", sqlite_url)

    with warnings.catch_warnings(record=True) as recorded_warnings:
        warnings.simplefilter("always")
        command.upgrade(cfg, "0055_performance_take_fk_and_scope_fix")
        sa_warnings = [w for w in recorded_warnings if issubclass(w.category, sa.exc.SAWarning)]
        assert len(sa_warnings) == 0, f"Unexpected SAWarnings during SQLite upgrade: {sa_warnings}"

    # 3. Introspect schema and verify columns, constraints, and indexes
    engine2 = create_engine(sqlite_url)
    inspector = inspect(engine2)
    cols = {c["name"]: c for c in inspector.get_columns("performance_takes")}
    assert cols["score_id"]["nullable"] is True
    assert cols["revision_id"]["nullable"] is True
    assert "score_title" in cols
    assert cols["score_title"]["nullable"] is True
    assert "scope_type" in cols
    assert cols["scope_type"]["nullable"] is False

    # Check backfilled data
    with engine2.connect() as conn:
        row = conn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type FROM performance_takes WHERE id = 1")).fetchone()
        assert row is not None
        assert row[0] == 1
        assert row[1] == "take-sqlite-001"
        assert row[2] == 1
        assert row[3] == 10
        assert row[4] == 100
        assert row[5] == "Sonata Allegro"  # safely backfilled
        assert row[6] == "FULL"

    # Check FKs: exactly 3 FKs, no duplicates
    fks = inspector.get_foreign_keys("performance_takes")
    assert len(fks) == 3, f"Expected 3 FKs, got {len(fks)}: {fks}"
    score_fk = next(f for f in fks if f["referred_table"] == "scores")
    assert score_fk["options"].get("ondelete") == "SET NULL"
    rev_fk = next(f for f in fks if f["referred_table"] == "score_revisions")
    assert rev_fk["options"].get("ondelete") == "SET NULL"
    user_fk = next(f for f in fks if f["referred_table"] == "users")
    assert user_fk["options"].get("ondelete") == "CASCADE"

    # Check indexes: all 5 indexes present
    indexes = inspector.get_indexes("performance_takes")
    index_names = {idx["name"] for idx in indexes}
    expected_indexes = {
        "ix_performance_takes_take_uuid",
        "ix_performance_takes_user_id",
        "ix_performance_takes_score_id",
        "ix_performance_takes_revision_id",
        "ix_performance_takes_client_request_id",
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
        row2 = conn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type FROM performance_takes WHERE id = 1")).fetchone()
        assert row2 is not None
        assert row2[3] is None  # score_id SET NULL
        assert row2[4] is None  # revision_id SET NULL
        assert row2[5] == "Sonata Allegro"  # title preserved
        assert row2[6] == "FULL"

    engine2.dispose()


def test_real_alembic_upgrade_chain_postgresql():
    """Verify real Alembic upgrade from 0053 -> 0054 -> 0055 on PostgreSQL."""
    import psycopg
    from alembic import command
    from alembic.config import Config
    import sqlalchemy as sa

    pg_url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL") or "postgresql://postgres:123456@192.168.31.59:5432/noteverse_pro"

    # Parse URL to get base connection info
    clean_pg_url = pg_url.replace("postgresql+asyncpg://", "postgresql://").replace("postgresql+psycopg://", "postgresql://")
    parsed = urllib.parse.urlparse(clean_pg_url)
    user = parsed.username or "postgres"
    password = parsed.password or "123456"
    host = parsed.hostname or "192.168.31.59"
    port = parsed.port or 5432

    base_pg = f"postgresql://{user}:{password}@{host}:{port}"
    test_db = "test_alembic_take_upgrade_pg"

    try:
        conn = psycopg.connect(f"{base_pg}/postgres", autocommit=True, connect_timeout=3)
    except Exception as exc:
        pytest.skip(f"PostgreSQL environment not available (NOT VERIFIED): {exc}")

    try:
        cur = conn.cursor()
        cur.execute(f"DROP DATABASE IF EXISTS {test_db}")
        cur.execute(f"CREATE DATABASE {test_db}")
        conn.close()

        # Connect to new test DB and setup 0053 state
        pg_conn = psycopg.connect(f"{base_pg}/{test_db}", autocommit=True)
        pcur = pg_conn.cursor()
        pcur.execute("CREATE TABLE alembic_version (version_num VARCHAR(128) NOT NULL, CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num));")
        pcur.execute("INSERT INTO alembic_version VALUES ('0053_performance_takes');")
        pcur.execute("CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL);")
        pcur.execute("INSERT INTO users (id, email) VALUES (1, 'u1@example.com');")
        pcur.execute("CREATE TABLE scores (id BIGSERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL);")
        pcur.execute("INSERT INTO scores (id, title) VALUES (10, 'PG Sonata Allegro');")
        pcur.execute("CREATE TABLE score_revisions (id BIGSERIAL PRIMARY KEY, score_id BIGINT NOT NULL REFERENCES scores(id) ON DELETE CASCADE);")
        pcur.execute("INSERT INTO score_revisions (id, score_id) VALUES (100, 10);")
        pcur.execute("""
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
        """)
        pcur.execute("CREATE UNIQUE INDEX ix_performance_takes_take_uuid ON performance_takes (take_uuid);")
        pcur.execute("CREATE INDEX ix_performance_takes_user_id ON performance_takes (user_id);")
        pcur.execute("CREATE INDEX ix_performance_takes_score_id ON performance_takes (score_id);")
        pcur.execute("CREATE INDEX ix_performance_takes_revision_id ON performance_takes (revision_id);")
        pcur.execute("CREATE INDEX ix_performance_takes_client_request_id ON performance_takes (client_request_id);")
        pcur.execute("""
        INSERT INTO performance_takes (
            id, take_uuid, user_id, score_id, revision_id, artifact_id, client_request_id,
            media_kind, media_mime_type, media_byte_size, media_object_key, storage_backend,
            duration_ms, scope_start_beat, scope_terminal_beat, created_at, updated_at
        ) VALUES (
            1, 'take-pg-001', 1, 10, 100, 'art-1', 'req-1',
            'AUDIO', 'audio/webm', 2048, 'users/1/takes/take-pg-001.webm', 's3',
            90000, 0.0, 32.0, '2026-09-20 14:00:00', '2026-09-20 14:00:00'
        );
        """)
        pg_conn.close()

        # Run real Alembic upgrade
        alembic_dir = str(Path(__file__).resolve().parents[1] / "alembic")
        cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        cfg.set_main_option("script_location", alembic_dir)
        cfg.set_main_option("sqlalchemy.url", f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{test_db}")

        command.upgrade(cfg, "0055_performance_take_fk_and_scope_fix")

        # Inspect on PG
        engine_pg = create_engine(f"postgresql+psycopg://{user}:{password}@{host}:{port}/{test_db}")
        inspector = inspect(engine_pg)
        cols = {c["name"]: c for c in inspector.get_columns("performance_takes")}
        assert cols["score_id"]["nullable"] is True
        assert cols["revision_id"]["nullable"] is True
        assert "score_title" in cols
        assert cols["score_title"]["nullable"] is True
        assert "scope_type" in cols
        assert cols["scope_type"]["nullable"] is False

        fks = inspector.get_foreign_keys("performance_takes")
        score_fk = next(f for f in fks if f["referred_table"] == "scores")
        assert score_fk["options"].get("ondelete") == "SET NULL"
        rev_fk = next(f for f in fks if f["referred_table"] == "score_revisions")
        assert rev_fk["options"].get("ondelete") == "SET NULL"

        with engine_pg.connect() as pconn:
            row = pconn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type FROM performance_takes WHERE id = 1")).fetchone()
            assert row is not None
            assert row[3] == 10
            assert row[4] == 100
            assert row[5] == "PG Sonata Allegro"
            assert row[6] == "FULL"

            # DELETE FROM scores on PG
            pconn.execute(sa.text("DELETE FROM scores WHERE id = 10;"))
            pconn.commit()

            row_after = pconn.execute(sa.text("SELECT id, take_uuid, user_id, score_id, revision_id, score_title, scope_type FROM performance_takes WHERE id = 1")).fetchone()
            assert row_after is not None
            assert row_after[3] is None  # score_id SET NULL
            assert row_after[4] is None  # revision_id SET NULL
            assert row_after[5] == "PG Sonata Allegro"  # title preserved
            assert row_after[6] == "FULL"

        engine_pg.dispose()

    finally:
        # Cleanup PG DB
        try:
            conn_clean = psycopg.connect(f"{base_pg}/postgres", autocommit=True, connect_timeout=3)
            cur_clean = conn_clean.cursor()
            cur_clean.execute(f"DROP DATABASE IF EXISTS {test_db}")
            conn_clean.close()
        except Exception:
            pass
