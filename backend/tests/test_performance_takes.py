from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
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
        # 1. Authorize upload
        media_content = b"fake-webm-audio-binary-data-12345"
        media_size = len(media_content)

        auth_req = {
            "score_id": 10,
            "revision_id": 100,
            "artifact_id": "art-1",
            "client_request_id": "req-001",
            "media_byte_size": media_size,
            "media_mime_type": "audio/webm",
            "duration_ms": 15000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 16.0,
            "tempo_selection": {"bpm": 120},
            "resolved_tempo_plan": {"bpm": 120},
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

        # 2. Finalize fails before upload
        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-001",
            "reservation_id": reservation_id,
            "score_id": 10,
            "revision_id": 100,
            "artifact_id": "art-1",
            "media_byte_size": media_size,
            "media_mime_type": "audio/webm",
            "duration_ms": 15000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 16.0,
        }
        res_fail = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fail.status_code == 404  # Media object not found in storage

        # 3. Simulate direct browser upload to OSS (writing directly to object storage)
        storage.put_bytes(key=object_key, content=media_content, content_type="audio/webm")

        # 4. Finalize fails if byte_size mismatch
        # Note: auto-release triggers on mismatch, so we test with wrong byte size
        fin_req_mismatch = dict(fin_req, media_byte_size=media_size + 10)
        res_mismatch = client.post("/api/v1/performance-takes", json=fin_req_mismatch)
        assert res_mismatch.status_code == 422

        # 5. Authorize again to get fresh reservation for successful finalize
        res_auth2 = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        take_id2 = res_auth2.json()["data"]["take_id"]
        reservation_id2 = res_auth2.json()["data"]["reservation_id"]
        object_key2 = res_auth2.json()["data"]["object_key"]
        storage.put_bytes(key=object_key2, content=media_content, content_type="audio/webm")

        fin_req2 = dict(fin_req, take_id=take_id2, reservation_id=reservation_id2)
        res_fin = client.post("/api/v1/performance-takes", json=fin_req2)
        assert res_fin.status_code == 200, res_fin.text
        take_data = res_fin.json()["data"]
        assert take_data["take_id"] == take_id2
        assert take_data["score_id"] == 10
        assert take_data["score_title"] == "Moonlight Sonata"  # Snapshotted title
        assert take_data["media_byte_size"] == media_size

        # Quota should now be committed (used = media_size, reserved = 0)
        session.refresh(account)
        assert account.reserved_bytes == 0
        assert account.used_bytes == media_size

        # 6. Idempotency: retry finalize with same client_request_id
        res_idempotent = client.post("/api/v1/performance-takes", json=fin_req2)
        assert res_idempotent.status_code == 200
        assert res_idempotent.json()["data"]["take_id"] == take_id2

        # 7. List takes with pagination metadata
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        list_data = res_list.json()["data"]
        assert list_data["total"] == 1
        assert list_data["limit"] == 50
        assert list_data["offset"] == 0
        assert list_data["has_more"] is False
        assert list_data["items"][0]["score_title"] == "Moonlight Sonata"

        # 8. Get take detail
        res_detail = client.get(f"/api/v1/performance-takes/{take_id2}")
        assert res_detail.status_code == 200
        assert res_detail.json()["data"]["take_id"] == take_id2
        assert res_detail.json()["data"]["score_title"] == "Moonlight Sonata"

        # 9. Get playback URL
        res_play = client.get(f"/api/v1/performance-takes/{take_id2}/playback-url")
        assert res_play.status_code == 200
        play_data = res_play.json()["data"]
        assert "playback_url" in play_data
        assert "download_url" in play_data

        # 10. Ownership check: User 2 cannot access or delete User 1's take
        app.dependency_overrides[get_current_user] = lambda: user_2
        res_other_get = client.get(f"/api/v1/performance-takes/{take_id2}")
        assert res_other_get.status_code == 404

        res_other_play = client.get(f"/api/v1/performance-takes/{take_id2}/playback-url")
        assert res_other_play.status_code == 404

        res_other_del = client.delete(f"/api/v1/performance-takes/{take_id2}")
        assert res_other_del.status_code == 404

        res_user2_list = client.get("/api/v1/performance-takes")
        assert res_user2_list.status_code == 200
        assert len(res_user2_list.json()["data"]["items"]) == 0

        # 11. Delete take as User 1
        app.dependency_overrides[get_current_user] = lambda: user_1
        res_del = client.delete(f"/api/v1/performance-takes/{take_id2}")
        assert res_del.status_code == 200
        assert res_del.json()["data"]["deleted"] is True

        # Verify take is gone from DB
        res_after_del = client.get(f"/api/v1/performance-takes/{take_id2}")
        assert res_after_del.status_code == 404

        # Verify quota is released
        session.refresh(account)
        assert account.used_bytes == 0

        # Verify storage object is deleted
        assert not storage.exists(object_key2)

        # Retry delete returns 404 and does not double-release quota
        res_retry_del = client.delete(f"/api/v1/performance-takes/{take_id2}")
        assert res_retry_del.status_code == 404
        session.refresh(account)
        assert account.used_bytes == 0

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
    app.dependency_overrides[get_current_user] = lambda: user_2  # User 2 does not own score 10
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = TestClient(app)

    try:
        # User 2 tries to practice/upload for score 10 without access -> 403 / 401
        auth_req = {
            "score_id": 10,
            "client_request_id": "req-no-access",
            "media_byte_size": 1024,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res.status_code in (401, 403)

        # User 1 with unsupported MIME type -> 422
        app.dependency_overrides[get_current_user] = lambda: user_1
        bad_mime_req = dict(auth_req, media_mime_type="video/mp4")
        res_mime = client.post("/api/v1/performance-takes/upload-authorizations", json=bad_mime_req)
        assert res_mime.status_code == 422

        # User 1 with invalid beat scope -> 422
        bad_beat_req = dict(auth_req, scope_start_beat=10.0, scope_terminal_beat=5.0)
        res_beat = client.post("/api/v1/performance-takes/upload-authorizations", json=bad_beat_req)
        assert res_beat.status_code == 422

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
            "score_id": 10,
            "client_request_id": "req-cancel-01",
            "media_byte_size": 5000,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res.status_code == 200
        res_id = res.json()["data"]["reservation_id"]

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


def test_score_deletion_independence(test_env):
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
        # Create a take
        content = b"audio-data-independence"
        size = len(content)
        auth_req = {
            "score_id": 10,
            "client_request_id": "req-indep-01",
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 10000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 8.0,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        take_id = res_auth.json()["data"]["take_id"]
        res_id = res_auth.json()["data"]["reservation_id"]
        key = res_auth.json()["data"]["object_key"]
        storage.put_bytes(key=key, content=content, content_type="audio/webm")

        fin_req = {
            "take_id": take_id,
            "client_request_id": "req-indep-01",
            "reservation_id": res_id,
            "score_id": 10,
            "media_byte_size": size,
            "media_mime_type": "audio/webm",
            "duration_ms": 10000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 8.0,
        }
        res_fin = client.post("/api/v1/performance-takes", json=fin_req)
        assert res_fin.status_code == 200
        assert res_fin.json()["data"]["score_title"] == "Moonlight Sonata"

        # Simulate score deletion by setting score_id to None on take (replicating ON DELETE SET NULL)
        take_row = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one()
        take_row.score_id = None
        session.commit()

        # Listing takes still works, score_id is None, score_title is still present
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        item = res_list.json()["data"]["items"][0]
        assert item["take_id"] == take_id
        assert item["score_id"] is None
        assert item["score_title"] == "Moonlight Sonata"

        # Playback URL still works
        res_play = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play.status_code == 200

        # Deleting take still works
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 200
        assert not storage.exists(key)

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
        # Request upload with size > 100MB quota limit
        excessive_size = 150 * 1024 * 1024
        auth_req = {
            "score_id": 10,
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


def test_cross_user_reservation_tampering(test_env):
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
        # User 1 authorizes an upload
        app.dependency_overrides[get_current_user] = lambda: user_1
        auth_req = {
            "score_id": 10,
            "client_request_id": "req-user1",
            "media_byte_size": 2048,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_auth1 = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
        assert res_auth1.status_code == 200
        res1_id = res_auth1.json()["data"]["reservation_id"]
        take1_id = res_auth1.json()["data"]["take_id"]

        # User 2 tries to finalize using User 1's reservation_id -> 422
        app.dependency_overrides[get_current_user] = lambda: user_2
        fin_req_tamper = {
            "take_id": take1_id,
            "client_request_id": "req-user2-tamper",
            "reservation_id": res1_id,
            "score_id": 10,
            "media_byte_size": 2048,
            "media_mime_type": "audio/webm",
            "duration_ms": 5000,
            "scope_start_beat": 0.0,
            "scope_terminal_beat": 4.0,
        }
        res_tamper = client.post("/api/v1/performance-takes", json=fin_req_tamper)
        assert res_tamper.status_code == 422

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
                "score_id": 10,
                "client_request_id": f"req-page-{i}",
                "media_byte_size": size,
                "media_mime_type": "audio/webm",
                "duration_ms": 5000,
                "scope_start_beat": 0.0,
                "scope_terminal_beat": 4.0,
            }
            res_auth = client.post("/api/v1/performance-takes/upload-authorizations", json=auth_req)
            data = res_auth.json()["data"]
            storage.put_bytes(key=data["object_key"], content=content, content_type="audio/webm")

            fin_req = {
                "take_id": data["take_id"],
                "client_request_id": f"req-page-{i}",
                "reservation_id": data["reservation_id"],
                "score_id": 10,
                "media_byte_size": size,
                "media_mime_type": "audio/webm",
                "duration_ms": 5000,
                "scope_start_beat": 0.0,
                "scope_terminal_beat": 4.0,
            }
            client.post("/api/v1/performance-takes", json=fin_req)

        # Page 1: limit=2, offset=0 -> 2 items, total=3, has_more=True
        res_p1 = client.get("/api/v1/performance-takes?limit=2&offset=0")
        assert res_p1.status_code == 200
        p1 = res_p1.json()["data"]
        assert p1["total"] == 3
        assert len(p1["items"]) == 2
        assert p1["limit"] == 2
        assert p1["offset"] == 0
        assert p1["has_more"] is True

        # Page 2: limit=2, offset=2 -> 1 item, total=3, has_more=False
        res_p2 = client.get("/api/v1/performance-takes?limit=2&offset=2")
        assert res_p2.status_code == 200
        p2 = res_p2.json()["data"]
        assert p2["total"] == 3
        assert len(p2["items"]) == 1
        assert p2["limit"] == 2
        assert p2["offset"] == 2
        assert p2["has_more"] is False

    finally:
        app.dependency_overrides.clear()

