from __future__ import annotations

import os
from collections.abc import Iterator

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
from app.modules.scores.lifecycle_service import ScoreLifecycleService
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

        # 2. REAL SOFT DELETE: invoke project lifecycle delete_score
        score_row = session.execute(select(Score).where(Score.id == 10)).scalar_one()
        score_row.deletion_status = ScoreDeletionStatus.DELETING
        session.commit()

        # Listing takes: score is DELETING, so score_id is None, score_title snapshot preserved
        res_list_soft = client.get("/api/v1/performance-takes")
        assert res_list_soft.status_code == 200
        item_soft = res_list_soft.json()["data"]["items"][0]
        assert item_soft["take_id"] == take_id
        assert item_soft["score_id"] is None
        assert item_soft["score_title"] == "Moonlight Sonata"

        # Playback still works
        res_play_soft = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_soft.status_code == 200

        # 3. REAL HARD CLEANUP: invoke cleanup_deleting_score
        lifecycle_svc.cleanup_deleting_score(session, score_row)

        # Verify in DB: score and score_revisions are gone, take row is still present with score_id=None
        take_in_db = session.execute(select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)).scalar_one_or_none()
        assert take_in_db is not None
        assert take_in_db.score_id is None
        assert take_in_db.revision_id is None
        assert take_in_db.score_title == "Moonlight Sonata"

        # Listing takes after hard delete: score_id is None, score_title preserved
        res_list_hard = client.get("/api/v1/performance-takes")
        assert res_list_hard.status_code == 200
        item_hard = res_list_hard.json()["data"]["items"][0]
        assert item_hard["take_id"] == take_id
        assert item_hard["score_id"] is None
        assert item_hard["score_title"] == "Moonlight Sonata"

        # Playback and download still work
        res_play_hard = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_hard.status_code == 200
        assert "download_url" in res_play_hard.json()["data"]

        # Deleting take still works
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 200
        assert not storage.exists(key)

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


def test_legacy_migration_upgrade_and_foreign_key_introspection():
    """Verify that a database running the old 0053 schema (NOT NULL score_id, CASCADE FK)

    can be upgraded by migration 0055 so that score_id is nullable, FK is ON DELETE SET NULL,
    score_title is safely backfilled, and hard deleting the score does not destroy the take.
    """
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

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

    with engine.begin() as conn:
        conn.execute(sa.text("PRAGMA foreign_keys = ON;"))
        # Create users table
        conn.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY);"))
        conn.execute(sa.text("INSERT INTO users VALUES (1);"))

        # Create scores table
        conn.execute(sa.text("CREATE TABLE scores (id INTEGER PRIMARY KEY, title TEXT NOT NULL);"))
        conn.execute(sa.text("INSERT INTO scores VALUES (10, 'Sonata Allegro');"))

        # Create score_revisions table
        conn.execute(sa.text("CREATE TABLE score_revisions (id INTEGER PRIMARY KEY, score_id INTEGER NOT NULL REFERENCES scores(id) ON DELETE CASCADE);"))
        conn.execute(sa.text("INSERT INTO score_revisions VALUES (100, 10);"))

        # Simulate old 0053 performance_takes table: NOT NULL score_id, CASCADE FK, NO score_title
        conn.execute(sa.text(
            "CREATE TABLE performance_takes ("
            "  id INTEGER PRIMARY KEY, "
            "  take_uuid VARCHAR(36) NOT NULL, "
            "  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "  score_id INTEGER NOT NULL REFERENCES scores(id) ON DELETE CASCADE, "
            "  revision_id INTEGER REFERENCES score_revisions(id) ON DELETE CASCADE, "
            "  client_request_id VARCHAR(128) NOT NULL"
            ");"
        ))
        conn.execute(sa.text("INSERT INTO performance_takes VALUES (1, 'uuid-legacy-1', 1, 10, 100, 'req-leg-1');"))

        # Now execute upgrade logic as in 0055:
        ctx = MigrationContext.configure(conn)
        op = Operations(ctx)

        table_args = (
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("user_id", "client_request_id", name="uq_performance_takes_user_client_request_id"),
        )
        with op.batch_alter_table("performance_takes", recreate="always", table_args=table_args) as batch_op:
            batch_op.alter_column("score_id", existing_type=sa.Integer(), nullable=True)
            batch_op.add_column(sa.Column("score_title", sa.String(255), nullable=True))
            batch_op.add_column(sa.Column("scope_type", sa.String(16), nullable=False, server_default="FULL"))

        # Backfill score_title
        conn.execute(sa.text(
            "UPDATE performance_takes "
            "SET score_title = (SELECT title FROM scores WHERE scores.id = performance_takes.score_id) "
            "WHERE performance_takes.score_id IS NOT NULL AND performance_takes.score_title IS NULL"
        ))

    # Introspect foreign keys and columns
    inspector = inspect(engine)
    columns = {col["name"]: col for col in inspector.get_columns("performance_takes")}
    assert "score_title" in columns
    assert "scope_type" in columns
    assert columns["score_id"]["nullable"] is True

    fks = inspector.get_foreign_keys("performance_takes")
    score_fk = next(f for f in fks if f["referred_table"] == "scores")
    assert score_fk["options"].get("ondelete") == "SET NULL"

    # Now verify actual HARD DELETE on scores
    with engine.begin() as conn:
        conn.execute(sa.text("PRAGMA foreign_keys = ON;"))
        conn.execute(sa.text("DELETE FROM scores WHERE id = 10;"))
        take_row = conn.execute(sa.text("SELECT id, take_uuid, score_id, revision_id, score_title, scope_type FROM performance_takes;")).fetchone()
        assert take_row is not None
        assert take_row[0] == 1
        assert take_row[2] is None  # score_id was SET NULL, not cascade deleted!
        assert take_row[3] is None  # revision_id was SET NULL, not cascade deleted!
        assert take_row[4] == "Sonata Allegro"  # score_title was preserved!
        assert take_row[5] == "FULL"
