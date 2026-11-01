from __future__ import annotations

import asyncio
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, inspect, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ValidationException
from app.db.models import (
    PerformanceTake,
    PerformanceTakeDeletionStatus,
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
    PerformanceTakeMediaKind,
    PerformanceTakeUploadReservation,
    PerformanceTakeUploadReservationStatus,
    PracticeSourceRecord,
    PracticeSourceDeleteOutbox,
    PracticeSourceDeleteOutboxStatus,
    PracticeSourceStatus,
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
from app.modules.practice.source.retention import (
    practice_source_delete_service,
)
from app.modules.performance_takes.dependencies import (
    get_performance_take_service,
)
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.practice.source.service import PracticeSourceService
from app.modules.practice.source.repository import PracticeSourceRepository
from app.modules.practice.source.domain import (
    AuthorizedPracticeSource,
    PracticeSource,
    PracticeSourceRepresentation,
    PracticeSourceArtifact,
)
from app.modules.score_access.policy import ScoreAction
from app.modules.practice.score.artifact import canonical_practice_artifact_bytes
from app.modules.scores.dependencies import get_score_service
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.modules.scores.service import ScoreService
from app.modules.storage_usage.dependencies import get_storage_usage_service
from app.modules.storage_usage.service import StorageUsageService
from app.shared.error_codes import ErrorCode
from app.storage.base import DirectUploadTarget
from app.storage.factory import get_file_storage
from app.storage.local import LocalFileStorage
from app.worker.execution import performance_take_deletion, practice_source_deletion

VALID_WEBM_BYTES = b"\x1a\x45\xdf\xa3" + b"fake-webm-audio-binary-data-12345"
DEFAULT_TAKE_REVISION_ID = "revision-uuid-100"
DEFAULT_TAKE_ARTIFACT_ID = "art-1"
DEFAULT_TAKE_TEMPO_PLAN = {
    "selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 120},
    "segments": [{"startBeat": 0, "bpm": 120, "source": "CUSTOM"}],
}
DEFAULT_TAKE_RECORDING_TIMEBASE = {
    "nominalMediaDurationMs": 5000,
    "activeSegments": [
        {
            "perfStartMs": 0,
            "perfEndMs": 5000,
            "mediaStartMs": 0,
            "mediaEndMs": 5000,
        }
    ],
}


class _FakePracticeSourceService(PracticeSourceService):
    async def resolve_source(self, db, score_uuid: str, user_id: int, revision_uuid: str):
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
        )
        reference, source = await self.repository.get_or_create(
            db, _canonical_source(score_uuid, revision_uuid, DEFAULT_TAKE_ARTIFACT_ID),
            live_revision_id=access.revision.id,
        )
        return AuthorizedPracticeSource(
            source, reference,
            access.score.id,
            access.revision.id,
            access.score.title,
        )


def _canonical_source(score_id, revision_id, artifact_id):
    value = _source_artifact_payload(score_id, revision_id, artifact_id)
    return PracticeSource(
        score_id,
        revision_id,
        PracticeSourceRepresentation(
            b'<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list /></score-partwise>',
            "application/vnd.recordare.musicxml+xml",
        ),
        PracticeSourceArtifact(
            PracticeSourceRepresentation(
                canonical_practice_artifact_bytes(value), "application/json"
            ),
            artifact_id,
            value["schemaVersion"],
        ),
    )


def _source_artifact_payload(score_id: str, revision_id: str, artifact_id: str):
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    value = json.loads(
        (
            root
            / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json"
        ).read_text()
    )
    value["events"][-1]["durationBeats"] = 16 - value["events"][-1]["onsetBeat"]
    value["moments"][-1]["canonicalEndBeat"] = 16
    value.update(
        scoreId=score_id,
        revisionId=revision_id,
        artifactId=artifact_id,
        scoreEndBeat=16,
        scoreTempoSegments=[{"startBeat": 0, "bpm": 120}],
    )
    return value


def _performance_take_service(
    *,
    storage: LocalFileStorage,
    storage_usage_service: StorageUsageService | None = None,
) -> PerformanceTakeService:
    return PerformanceTakeService(
        storage=storage,
        storage_usage_service=storage_usage_service,
        practice_source_service=_FakePracticeSourceService(storage=storage),
    )


def _create_default_source(
    session: Session,
    storage: LocalFileStorage,
    *,
    source_score_uuid: str = "score-uuid-10",
    source_revision_uuid: str = DEFAULT_TAKE_REVISION_ID,
    artifact_id: str = DEFAULT_TAKE_ARTIFACT_ID,
) -> PracticeSourceRecord:
    source_value = _canonical_source(source_score_uuid, source_revision_uuid, artifact_id)
    musicxml_bytes = source_value.prepared_musicxml.data
    artifact_bytes = source_value.artifact.representation.data
    musicxml_sha = source_value.prepared_musicxml.sha256
    artifact_sha = source_value.artifact.representation.sha256
    source_id = source_value.source_id
    existing = session.execute(
        select(PracticeSourceRecord).where(
            PracticeSourceRecord.source_id == source_id
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    musicxml_key = f"practice-sources/{source_id}/score.musicxml"
    artifact_key = f"practice-sources/{source_id}/artifact.json"
    storage.put_bytes(
        key=musicxml_key,
        content=musicxml_bytes,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    storage.put_bytes(key=artifact_key, content=artifact_bytes, content_type="application/json")
    source = PracticeSourceRecord(
        source_id=source_id,
        source_score_uuid=source_score_uuid,
        source_revision_uuid=source_revision_uuid,
        artifact_id=artifact_id,
        artifact_schema_version=1,
        prepared_musicxml_object_key=musicxml_key,
        prepared_musicxml_sha256=musicxml_sha,
        prepared_musicxml_byte_size=len(musicxml_bytes),
        artifact_object_key=artifact_key,
        artifact_sha256=artifact_sha,
        artifact_byte_size=len(artifact_bytes),
        status=PracticeSourceStatus.READY.value,
        creation_expires_at=None,
    )
    session.add(source)
    session.flush()
    return source


def _create_default_take(
    session: Session,
    *,
    user_id: int,
    practice_source_id: int,
    client_request_id: str,
    take_uuid: str,
    media_object_key: str,
    linked_score_id: int | None = 10,
) -> PerformanceTake:
    source = session.get(PracticeSourceRecord, practice_source_id)
    reservation = PerformanceTakeUploadReservation(
        user_id=user_id,
        client_request_id=client_request_id,
        take_uuid=take_uuid,
        score_uuid=source.source_score_uuid,
        score_title="Moonlight Sonata",
        revision_uuid=source.source_revision_uuid,
        artifact_id=source.artifact_id,
        scope_type="FULL",
        scope_start_beat=0,
        scope_terminal_beat=4,
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        duration_ms=5000,
        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        storage_backend="local",
        staging_object_key=media_object_key + ".staging",
        final_object_key=media_object_key,
        storage_reservation_id="quota-" + take_uuid,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None),
        status="COMPLETED",
    )
    session.add(reservation)
    session.flush()
    take = PerformanceTake(
        take_uuid=take_uuid,
        user_id=user_id,
        practice_source_id=practice_source_id,
        linked_score_id=linked_score_id,
        score_title_snapshot="Moonlight Sonata",
        upload_reservation_id=reservation.id,
        media_kind=PerformanceTakeMediaKind.AUDIO,
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        media_object_key=media_object_key,
        storage_backend="local",
        duration_ms=5000,
        scope_type="FULL",
        scope_start_beat=0.0,
        scope_terminal_beat=4.0,
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        deletion_status=PerformanceTakeDeletionStatus.ACTIVE,
    )
    session.add(take)
    session.flush()
    return take


def test_invalid_stored_scope_reports_validation_error(test_env):
    session, storage, user, _ = test_env
    source = _create_default_source(session, storage)
    take = _create_default_take(
        session,
        user_id=user.id,
        practice_source_id=source.id,
        client_request_id="invalid-stored-scope",
        take_uuid="invalid-stored-scope",
        media_object_key="test/invalid-stored-scope.webm",
    )
    take.scope_type = "INVALID"
    service = PerformanceTakeService(storage=storage)
    with pytest.raises(ValidationException) as raised:
        service._to_read_dto(take, source_ref=source)
    assert raised.value.code == ErrorCode.VALIDATION_ERROR
    assert raised.value.details == {"field": "scope_type", "reason": "scope_type_invalid"}


def test_source_materialization_stores_exact_source_value_and_rejects_inflight_reuse(test_env):
    session, storage, _, _ = test_env
    source_value = _canonical_source("score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID)
    repository = PracticeSourceRepository(storage)
    original_put = storage.put_bytes
    writes = []
    inflight = []

    def put(**kwargs):
        writes.append(kwargs["key"])
        if not inflight:
            with pytest.raises(ValidationException) as caught:
                _run_async(repository.get_or_create(AsyncSessionAdapter(session), source_value, live_revision_id=100))
            inflight.append(caught.value.details["reason"])
        return original_put(**kwargs)

    with patch.object(storage, "put_bytes", side_effect=put):
        (first, verified) = _run_async(repository.get_or_create(AsyncSessionAdapter(session), source_value, live_revision_id=100))
        (second, _) = _run_async(repository.get_or_create(AsyncSessionAdapter(session), source_value, live_revision_id=100))
    assert first == second
    assert verified == source_value
    assert first.source_id == source_value.source_id
    assert inflight == ["practice_source_not_ready"]
    assert len(writes) == 2
    row = session.get(PracticeSourceRecord, first.id)
    assert storage.read_bytes(row.prepared_musicxml_object_key) == source_value.prepared_musicxml.data
    assert storage.read_bytes(row.artifact_object_key) == source_value.artifact.representation.data
    assert row.prepared_musicxml_sha256 == source_value.prepared_musicxml.sha256
    assert row.artifact_sha256 == source_value.artifact.representation.sha256
    assert row.prepared_musicxml_byte_size == source_value.prepared_musicxml.byte_size
    assert row.artifact_byte_size == source_value.artifact.representation.byte_size


@pytest.mark.parametrize("representation", ["prepared_musicxml", "artifact"])
def test_practice_source_checksum_corruption_is_rejected(test_env, representation):
    session, storage, _, _ = test_env
    row = _create_default_source(session, storage)
    key = getattr(row, f"{representation}_object_key")
    storage.put_bytes(key=key, content=b"corrupt", content_type="application/octet-stream")
    with pytest.raises(ValidationException) as caught:
        _run_async(
            PracticeSourceService(storage=storage).read_source_by_id(
                AsyncSessionAdapter(session), row.id
            )
        )
    assert caught.value.details["reason"] == f"{representation}_checksum_mismatch"


def test_practice_source_artifact_identity_corruption_is_rejected(test_env):
    session, storage, _, _ = test_env
    row = _create_default_source(session, storage)
    changed = _canonical_source(
        "other-score", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID
    ).artifact.representation
    storage.put_bytes(
        key=row.artifact_object_key, content=changed.data, content_type=changed.mime_type
    )
    row.artifact_sha256 = changed.sha256
    row.artifact_byte_size = changed.byte_size
    session.commit()
    with pytest.raises(ValidationException) as caught:
        _run_async(
            PracticeSourceService(storage=storage).read_source_by_id(
                AsyncSessionAdapter(session), row.id
            )
        )
    assert caught.value.details["reason"] == "artifact_identity_mismatch"


def _create_take_delete_outbox(
    session: Session,
    take: PerformanceTake,
) -> PerformanceTakeDeleteOutbox:
    outbox = PerformanceTakeDeleteOutbox(
        take_id=take.id,
        take_uuid=take.take_uuid,
        user_id=take.user_id,
        storage_backend=take.storage_backend,
        object_key=take.media_object_key,
        media_byte_size=take.media_byte_size,
        status=PerformanceTakeDeleteOutboxStatus.PENDING.value,
        next_attempt_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    take.deletion_status = PerformanceTakeDeletionStatus.DELETING
    session.add(outbox)
    session.flush()
    return outbox


def test_performance_take_schema_accepts_product_default_tempo_source() -> None:
    request = PerformanceTakeUploadReservationRequest.model_validate(
        _reservation_request_payload(
            {
                "source": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
                },
                "media": {
                    "kind": "AUDIO",
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                    "duration_ms": 5000,
                },
                "scope": {"kind": "FULL", "start_beat": 0, "terminal_beat": 16},
                "client_request_id": "req-product-default-tempo",
                "tempo_plan": {
                    "selection": {"mode": "SCORE"},
                    "segments": [{"startBeat": 0, "bpm": 80, "source": "PRODUCT_DEFAULT"}],
                },
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            }
        )
    )

    assert request.tempo_plan.segments[0].source == "PRODUCT_DEFAULT"


POSTGRES_MIGRATION_EMPTY_URL_ENV = "NOTEVERSE_TEST_POSTGRES_MIGRATION_EMPTY_URL"
POSTGRES_MIGRATION_RESTRICTED_ALEMBIC_URL_ENV = (
    "NOTEVERSE_TEST_POSTGRES_MIGRATION_RESTRICTED_ALEMBIC_URL"
)
POSTGRES_TEST_DATABASE_PREFIX = "noteverse_test_"


@dataclass(frozen=True)
class PostgresMigrationTestDatabase:
    database_name: str
    psycopg_url: str
    sqlalchemy_sync_url: str
    alembic_async_url: str


class AsyncSessionAdapter:
    def __init__(self, session: Session) -> None:
        self.session = session

    async def execute(self, statement, params=None, *args, **kwargs):  # type: ignore[no-untyped-def]
        return self.session.execute(statement, params=params, *args, **kwargs)

    async def run_sync(self, function):
        return function(self.session)

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

    async def invalidate(self) -> None:
        # The production AsyncSession invalidates the stale connection here.
        # SQLite's synchronous test adapter has no pooled async connection to invalidate.
        return None

    async def delete(self, instance) -> None:  # type: ignore[no-untyped-def]
        self.session.delete(instance)

    def add(self, instance) -> None:  # type: ignore[no-untyped-def]
        self.session.add(instance)

    def begin_nested(self):  # type: ignore[no-untyped-def]
        transaction = self.session.begin_nested()

        class _NestedTransaction:
            async def __aenter__(self):  # type: ignore[no-untyped-def]
                transaction.__enter__()
                return transaction

            async def __aexit__(self, exc_type, exc, tb):  # type: ignore[no-untyped-def]
                return transaction.__exit__(exc_type, exc, tb)

        return _NestedTransaction()


def _reservation_request_payload(payload):
    if not isinstance(payload, dict):
        return payload
    value = dict(payload)
    value["source"] = {
        "revision_id": DEFAULT_TAKE_REVISION_ID,
        "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
        **value.get("source", {}),
    }
    value["media"] = {"kind": "AUDIO", **value.get("media", {})}
    value["scope"] = {"kind": "FULL", **value.get("scope", {})}
    value.setdefault("tempo_plan", DEFAULT_TAKE_TEMPO_PLAN)
    value.setdefault("recording_timebase", DEFAULT_TAKE_RECORDING_TIMEBASE)
    return value


class PerformanceTakeTestClient(TestClient):
    def post(self, url, *args, **kwargs):
        if url.endswith("/api/v1/performance-takes/upload-reservations"):
            kwargs["json"] = _reservation_request_payload(kwargs.get("json"))
        return super().post(url, *args, **kwargs)


def _staging_key(session, reservation_id):
    return session.execute(
        select(PerformanceTakeUploadReservation.staging_object_key).where(
            PerformanceTakeUploadReservation.reservation_uuid == reservation_id,
        )
    ).scalar_one()


def _run_async(awaitable):  # type: ignore[no-untyped-def]
    return asyncio.run(awaitable)


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


def _run_source_deletion(
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
    storage: LocalFileStorage,
    outbox_uuid: str,
) -> dict[str, str]:
    monkeypatch.setattr(
        practice_source_deletion,
        "get_worker_db",
        lambda: _mock_worker_db(session),
    )
    monkeypatch.setattr(practice_source_deletion, "file_storage", storage)
    monkeypatch.setattr(
        practice_source_deletion,
        "start_attempt_trace",
        lambda **_kwargs: _TraceScope(),
    )
    return practice_source_deletion.execute_practice_source_deletion_task(
        None, outbox_uuid
    )


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
    def mock_upload_url(
        key: str, *, content_type: str, checksum_sha256: str = ""
    ) -> DirectUploadTarget:
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
    client = PerformanceTakeTestClient(app)

    r1 = client.post("/api/v1/performance-takes/upload-reservations", json={})
    assert r1.status_code == 401

    r2 = client.post("/api/v1/performance-takes/upload-reservations/" + "unknown" + "/finalize")
    assert r2.status_code == 401

    r3 = client.get("/api/v1/performance-takes")
    assert r3.status_code == 401

    r4 = client.get("/api/v1/performance-takes/some-uuid")
    assert r4.status_code == 401

    r5 = client.get("/api/v1/performance-takes/some-uuid/playback-url")
    assert r5.status_code == 401

    r6 = client.get("/api/v1/performance-takes/some-uuid/media")
    assert r6.status_code == 401

    r7 = client.delete("/api/v1/performance-takes/some-uuid")
    assert r7.status_code == 401


def test_take_lifecycle_direct_oss_and_quota(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        # 1. Authorize upload with external UUIDs
        media_content = VALID_WEBM_BYTES
        media_size = len(media_content)

        auth_req = {
            "source": {
                "score_id": "score-uuid-10",
                "revision_id": "revision-uuid-100",
                "artifact_id": "art-1",
            },
            "media": {"byte_size": media_size, "mime_type": "audio/webm", "duration_ms": 15000},
            "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 16.0},
            "client_request_id": "req-001",
            "tempo_plan": {
                "selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 120},
                "segments": [{"startBeat": 0, "bpm": 120, "source": "CUSTOM"}],
            },
            "recording_timebase": {
                "nominalMediaDurationMs": 15000,
                "activeSegments": [
                    {
                        "perfStartMs": 0,
                        "perfEndMs": 15000,
                        "mediaStartMs": 0,
                        "mediaEndMs": 15000,
                    }
                ],
            },
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res.status_code == 200, res.text
        auth_data = res.json()["data"]
        take_id = auth_data["take_id"]
        reservation_id = auth_data["reservation_id"]
        upload_url = auth_data["upload_target"]["url"]
        staging_object_key = _staging_key(session, auth_data["reservation_id"])
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
        reserved_upload_id = reservation_id
        res_fail = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fail.status_code == 404

        # Quota reservation is preserved for safe retry
        session.refresh(account)
        assert account.reserved_bytes == media_size

        # 3. Simulate client direct upload to staging storage object
        storage.put_bytes(key=staging_object_key, content=media_content, content_type="audio/webm")

        # 4. Finalize successfully with external UUIDs
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200, res_fin.text
        take_data = res_fin.json()["data"]
        assert take_data["take_id"] == take_id
        assert take_data["source_score_id"] == "score-uuid-10"
        assert take_data["source_revision_id"] == "revision-uuid-100"
        assert take_data["score_title_snapshot"] == "Moonlight Sonata"
        assert take_data["scope_type"] == "FULL"
        assert take_data["media_byte_size"] == media_size
        assert take_data["deletion_status"] == "ACTIVE"

        # Final key is promoted to a token-owned candidate object. Staging may
        # remain until every issued PUT URL expires.
        take_row = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one()
        source = session.get(PracticeSourceRecord, take_row.practice_source_id)
        assert source is not None
        assert source.source_score_uuid == "score-uuid-10"
        assert source.source_revision_uuid == "revision-uuid-100"
        assert source.artifact_id == "art-1"
        assert storage.exists(source.prepared_musicxml_object_key)
        assert storage.exists(source.artifact_object_key)
        expected_source_value = _canonical_source(
            "score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID
        )
        assert (
            storage.read_bytes(source.prepared_musicxml_object_key)
            == expected_source_value.prepared_musicxml.data
        )
        assert (
            storage.read_bytes(source.artifact_object_key)
            == expected_source_value.artifact.representation.data
        )
        assert source.source_id == expected_source_value.source_id

        with patch.object(
            take_svc.practice_source_service.repository,
            "read",
            wraps=take_svc.practice_source_service.repository.read,
        ) as read:
            res_source = client.get(
                f"/api/v1/performance-takes/{take_id}/practice-source?include_notation=true"
            )
        assert read.call_count == 1
        assert res_source.status_code == 200, res_source.text
        source_data = res_source.json()["data"]
        assert source_data["source_id"] == source.source_id
        assert "<score-partwise" in source_data["notation"]["musicxml"]
        assert source_data["artifact"]["scoreId"] == "score-uuid-10"
        assert source_data["artifact"]["revisionId"] == "revision-uuid-100"
        assert source_data["artifact"]["artifactId"] == "art-1"
        artifact_only = client.get(f"/api/v1/performance-takes/{take_id}/practice-source").json()[
            "data"
        ]
        assert artifact_only["source_id"] == source_data["source_id"]
        assert artifact_only["notation"] is None
        final_object_key = take_row.media_object_key
        assert final_object_key.startswith(f"performance-takes/1/{take_id}/")
        assert final_object_key != staging_object_key
        assert storage.exists(final_object_key)
        assert storage.exists(staging_object_key)
        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-001"
            )
        ).scalar_one()
        auth.last_put_url_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            minutes=1
        )
        auth.staging_cleanup_after = auth.last_put_url_expires_at
        session.commit()
        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()
        assert cleaned_count == 1
        assert not storage.exists(staging_object_key)

        # Quota should now be committed
        session.refresh(account)
        assert account.reserved_bytes == 0
        assert account.used_bytes == media_size

        # 6. Idempotency: retry finalize with same client_request_id
        res_idempotent = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_idempotent.status_code == 200
        assert res_idempotent.json()["data"]["take_id"] == take_id
        assert res_idempotent.json()["data"]["source_score_id"] == "score-uuid-10"

        conflicting_auth_req = {
            **auth_req,
            "media": {**auth_req["media"], "byte_size": media_size + 1},
        }
        res_conflict = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json=conflicting_auth_req,
        )
        assert res_conflict.status_code == 422
        with pytest.raises(Exception) as conflict_exc:
            _run_async(
                take_svc.reserve_upload(
                    AsyncSessionAdapter(session),
                    user_1.id,
                    PerformanceTakeUploadReservationRequest.model_validate(
                        _reservation_request_payload(conflicting_auth_req)
                    ),
                )
            )
        assert (
            getattr(conflict_exc.value, "details", {}).get("reason")
            == "client_request_id_reuse_conflict"
        )

        # 7. List takes
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        items = res_list.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["take_id"] == take_id
        assert items[0]["source_score_id"] == "score-uuid-10"
        assert items[0]["score_title_snapshot"] == "Moonlight Sonata"

        # 8. Get take detail
        res_detail = client.get(f"/api/v1/performance-takes/{take_id}")
        assert res_detail.status_code == 200
        assert res_detail.json()["data"]["take_id"] == take_id
        assert res_detail.json()["data"]["source_score_id"] == "score-uuid-10"

        # 9. Get playback URL
        res_play = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play.status_code == 200
        play_data = res_play.json()["data"]
        assert "playback_url" in play_data
        assert "download_url" in play_data

        # Historical share production uses the authenticated same-origin
        # stream instead of relying on cross-origin signed-URL fetch/CORS.
        res_media = client.get(f"/api/v1/performance-takes/{take_id}/media")
        assert res_media.status_code == 200
        assert res_media.content == media_content
        assert res_media.headers["content-type"].startswith("audio/webm")
        assert "performance-" in res_media.headers.get("content-disposition", "")
        res_media_range = client.get(
            f"/api/v1/performance-takes/{take_id}/media",
            headers={"Range": "bytes=0-3"},
        )
        assert res_media_range.status_code == 206
        assert res_media_range.content == media_content[:4]

        app.dependency_overrides[get_current_user] = lambda: user_2
        res_media_other_user = client.get(f"/api/v1/performance-takes/{take_id}/media")
        assert res_media_other_user.status_code == 404
        assert media_content not in res_media_other_user.content
        app.dependency_overrides[get_current_user] = lambda: user_1

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
        res_media_deleting = client.get(f"/api/v1/performance-takes/{take_id}/media")
        assert res_media_deleting.status_code == 404

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
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        # Invalid mime type rejected
        req_bad_mime = {
            "source": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
            },
            "media": {"byte_size": 1024, "mime_type": "video/mp4", "duration_ms": 5000},
            "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-bad-mime",
            "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_bad_mime)
        assert res.status_code == 422

        # Invalid beat scope (start >= terminal)
        req_bad_scope = {
            "source": {"score_id": "score-uuid-10"},
            "media": {"byte_size": 1024, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"start_beat": 4.0, "terminal_beat": 4.0},
            "client_request_id": "req-bad-scope",
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_bad_scope)
        assert res.status_code == 422

        # Nonexistent score UUID returns 404
        req_bad_score = {
            "source": {
                "score_id": "nonexistent-score-uuid",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
            },
            "media": {"byte_size": 1024, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-bad-score",
            "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_bad_score)
        assert res.status_code == 404

    finally:
        app.dependency_overrides.clear()


def test_unrelated_revision_rejected(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

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

        # Try to reserve with score-uuid-10 and unrelated revision-uuid-200
        req_unrelated = {
            "source": {"score_id": "score-uuid-10", "revision_id": "revision-uuid-200"},
            "media": {"byte_size": 1024, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-unrelated-rev",
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_unrelated)
        assert res.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_cross_user_score_permission(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

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

        # User 1 cannot reserve upload on User 2's private score
        app.dependency_overrides[get_current_user] = lambda: user_1
        req_unauth = {
            "source": {
                "score_id": "score-uuid-user2",
                "revision_id": "revision-uuid-user2",
                "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
            },
            "media": {"byte_size": 1024, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-cross-user-auth",
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_unauth)
        assert res.status_code in (403, 404)
    finally:
        app.dependency_overrides.clear()


def test_real_soft_delete_and_real_cleanup_hard_delete(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        # 1. Create a take on score 10
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "source": {"score_id": "score-uuid-10", "revision_id": "revision-uuid-100"},
            "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 10000},
            "scope": {"start_beat": 0.0, "terminal_beat": 8.0},
            "client_request_id": "req-real-delete-01",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        staging_key = _staging_key(session, auth_data["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        reserved_upload_id = res_id
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200
        assert res_fin.json()["data"]["score_title_snapshot"] == "Moonlight Sonata"

        take_row = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one()
        final_key = take_row.media_object_key
        assert final_key.startswith(f"performance-takes/1/{take_id}/")
        assert storage.exists(final_key)

        # Initial list check: source identity is returned and live navigation is available.
        res_init_list = client.get("/api/v1/performance-takes")
        assert res_init_list.status_code == 200
        init_item = res_init_list.json()["data"]["items"][0]
        assert init_item["source_score_id"] == "score-uuid-10"
        assert init_item["linked_score_id"] == "score-uuid-10"
        assert init_item["can_open_score"] is True

        # 2. REAL SOFT DELETE: invoke real ScoreService.batch_delete / HTTP POST /api/v1/scores/batch-delete
        score_svc = ScoreService(storage=storage)
        app.dependency_overrides[get_score_service] = lambda: score_svc

        res_soft = client.post("/api/v1/scores/batch-delete", json={"score_ids": ["score-uuid-10"]})
        assert res_soft.status_code == 200
        assert res_soft.json()["data"]["removed"] == 1

        score_row = session.execute(select(Score).where(Score.id == 10)).scalar_one()
        assert score_row.deletion_status == ScoreDeletionStatus.DELETING

        # Listing takes: source identity is retained even while the score is hidden/deleting.
        res_list_soft = client.get("/api/v1/performance-takes")
        assert res_list_soft.status_code == 200
        item_soft = res_list_soft.json()["data"]["items"][0]
        assert item_soft["take_id"] == take_id
        assert item_soft["source_score_id"] == "score-uuid-10"
        assert item_soft["source_revision_id"] == "revision-uuid-100"
        assert item_soft["source_artifact_id"] == DEFAULT_TAKE_ARTIFACT_ID
        assert item_soft["score_title_snapshot"] == "Moonlight Sonata"

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

        # Verify in DB: live score rows are physically deleted. The take no longer
        # points at live score/revision rows; its durable source remains independently retained.
        retained_score = session.execute(select(Score).where(Score.id == 10)).scalar_one_or_none()
        assert retained_score is None

        # Verify in DB: take row is preserved with required source identity.
        take_in_db = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one_or_none()
        assert take_in_db is not None
        assert take_in_db.linked_score_id is None
        assert take_in_db.score_title_snapshot == "Moonlight Sonata"
        source = session.get(PracticeSourceRecord, take_in_db.practice_source_id)
        assert source is not None
        assert source.source_score_uuid == "score-uuid-10"
        assert source.source_revision_uuid == "revision-uuid-100"
        assert storage.exists(source.prepared_musicxml_object_key)
        assert storage.exists(source.artifact_object_key)

        # Verify storage: media object is STILL PRESERVED!
        assert storage.exists(final_key)

        # Verify storage quota: user quota is STILL PRESERVED!
        session.refresh(account)
        assert account.used_bytes == size

        # Listing takes after score cleanup: exact source identity remains recoverable.
        res_list_hard = client.get("/api/v1/performance-takes")
        assert res_list_hard.status_code == 200
        item_hard = res_list_hard.json()["data"]["items"][0]
        assert item_hard["take_id"] == take_id
        assert item_hard["source_score_id"] == "score-uuid-10"
        assert item_hard["source_revision_id"] == "revision-uuid-100"
        assert item_hard["source_artifact_id"] == DEFAULT_TAKE_ARTIFACT_ID
        assert item_hard["score_title_snapshot"] == "Moonlight Sonata"
        assert item_hard["linked_score_id"] is None
        assert item_hard["can_open_score"] is False

        # Playback and download still work after score hard delete
        res_play_hard = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_hard.status_code == 200
        assert "download_url" in res_play_hard.json()["data"]
        source = client.get(
            f"/api/v1/performance-takes/{take_id}/practice-source?include_notation=true"
        )
        assert source.status_code == 200, source.text
        assert source.json()["data"]["artifact"]["revisionId"] == DEFAULT_TAKE_REVISION_ID
        assert source.json()["data"]["artifact"]["artifactId"] == DEFAULT_TAKE_ARTIFACT_ID
        assert "<score-partwise" in source.json()["data"]["notation"]["musicxml"]

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
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-idemp-del",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        take_id = res_auth.json()["data"]["take_id"]
        res_id = res_auth.json()["data"]["reservation_id"]
        staging_key = _staging_key(session, res_auth.json()["data"]["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        reserved_upload_id = res_id
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200

        # First delete succeeds and returns 202
        res_del1 = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del1.status_code == 202

        # Second delete while DELETING returns 202 idempotently
        res_del2 = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del2.status_code == 202

        # Exactly 1 outbox record in DB
        outboxes = (
            session.execute(
                select(PerformanceTakeDeleteOutbox).where(
                    PerformanceTakeDeleteOutbox.take_uuid == take_id
                )
            )
            .scalars()
            .all()
        )
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
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        account = session.get(StorageUsageAccount, 1)
        account.quota_limit_bytes = 1024 * 1024
        session.commit()
        excessive_size = 2 * 1024 * 1024
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {"byte_size": excessive_size, "mime_type": "audio/webm", "duration_ms": 60000},
            "scope": {"start_beat": 0.0, "terminal_beat": 16.0},
            "client_request_id": "req-huge",
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res.status_code == 422
        assert res.json()["public_code"] == "storage_quota_exceeded"
    finally:
        app.dependency_overrides.clear()


def test_cancel_upload_reservation(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        auth_req = {
            "source": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
            },
            "media": {"byte_size": 5000, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-cancel-01",
            "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        res_id = res_auth.json()["data"]["reservation_id"]
        staging_key = _staging_key(session, res_auth.json()["data"]["reservation_id"])
        storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
        auth_before_cancel = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == res_id
            )
        ).scalar_one()
        practice_source_id = auth_before_cancel.practice_source_id
        source = session.get(PracticeSourceRecord, practice_source_id)
        assert source is not None
        musicxml_key = source.prepared_musicxml_object_key
        artifact_key = source.artifact_object_key

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == 5000

        # Cancel reservation via DELETE route
        res_cancel = client.delete(f"/api/v1/performance-takes/upload-reservations/{res_id}")
        assert res_cancel.status_code == 200
        assert res_cancel.json()["data"]["cancelled"] is True

        session.refresh(account)
        assert account.reserved_bytes == 0
        assert storage.exists(staging_key)

        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == res_id
            )
        ).scalar_one()
        assert auth.practice_source_id is None
        auth.last_put_url_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            minutes=1
        )
        auth.staging_cleanup_after = auth.last_put_url_expires_at
        session.commit()
        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()
        assert cleaned_count == 1
        assert not storage.exists(staging_key)
        assert session.execute(select(PracticeSourceDeleteOutbox).where(
            PracticeSourceDeleteOutbox.practice_source_id == practice_source_id
        )).scalar_one_or_none() is None
        retained = session.get(PracticeSourceRecord, practice_source_id)
        session.refresh(retained)
        assert retained.status == PracticeSourceStatus.READY.value
        assert retained.live_revision_id == 100
        assert storage.exists(musicxml_key)
        assert storage.exists(artifact_key)

        # Idempotent cancel via the canonical DELETE route.
        res_cancel_delete_again = client.delete(
            f"/api/v1/performance-takes/upload-reservations/{res_id}"
        )
        assert res_cancel_delete_again.status_code == 200
        assert res_cancel_delete_again.json()["data"]["cancelled"] is True

    finally:
        app.dependency_overrides.clear()


def test_pagination(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        # Create 3 takes for User 1 with valid container bytes
        for i in range(1, 4):
            content = VALID_WEBM_BYTES + f"-take-{i}".encode()
            size = len(content)
            auth_req = {
                "source": {"score_id": "score-uuid-10"},
                "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
                "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": f"req-page-{i}",
                "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            }
            res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
            assert res_auth.status_code == 200
            data = res_auth.json()["data"]
            res_id = data["reservation_id"]
            storage.put_bytes(
                key=_staging_key(session, data["reservation_id"]),
                content=content,
                content_type="audio/webm",
            )

            reserved_upload_id = res_id
            res_fin = client.post(
                "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
            )
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
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        # 1. Invalid container header rejected with 422 media_mime_type
        bad_content = b"INVALID_MAGIC_BYTES_1234567890"
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {
                "byte_size": len(bad_content),
                "mime_type": "audio/webm",
                "duration_ms": 5000,
            },
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-bad-magic",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        staging_key = _staging_key(session, auth_data["reservation_id"])
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(key=staging_key, content=bad_content, content_type="audio/webm")

        reserved_upload_id = res_id
        res_fin_bad = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin_bad.status_code == 422
        assert res_fin_bad.json()["public_code"] == "validation_error"
        # Final immutable object was NEVER created
        final_key = f"performance-takes/1/{take_id}/recording.webm"
        assert not storage.exists(final_key)

        # 2. Valid OGG container: b"OggS..."
        ogg_content = b"OggS" + b"\x00" * 40
        auth_ogg = {
            "source": {"score_id": "score-uuid-10"},
            "media": {"byte_size": len(ogg_content), "mime_type": "audio/ogg", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-ogg-magic",
        }
        res_auth_ogg = client.post("/api/v1/performance-takes/upload-reservations", json=auth_ogg)
        assert res_auth_ogg.status_code == 200
        ogg_auth_data = res_auth_ogg.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, ogg_auth_data["reservation_id"]),
            content=ogg_content,
            content_type="audio/ogg",
        )
        ogg_reservation_id = ogg_auth_data["reservation_id"]
        res_ogg_reservation_id = client.post(
            "/api/v1/performance-takes/upload-reservations/" + ogg_reservation_id + "/finalize"
        )
        assert res_ogg_reservation_id.status_code == 200

        # 3. Valid WAV container: b"RIFF....WAVE..."
        wav_content = b"RIFF" + b"\x24\x00\x00\x00" + b"WAVEfmt " + b"\x00" * 32
        auth_wav = {
            "source": {"score_id": "score-uuid-10"},
            "media": {"byte_size": len(wav_content), "mime_type": "audio/wav", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-wav-magic",
        }
        res_auth_wav = client.post("/api/v1/performance-takes/upload-reservations", json=auth_wav)
        assert res_auth_wav.status_code == 200
        wav_auth_data = res_auth_wav.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, wav_auth_data["reservation_id"]),
            content=wav_content,
            content_type="audio/wav",
        )
        wav_reservation_id = wav_auth_data["reservation_id"]
        res_wav_reservation_id = client.post(
            "/api/v1/performance-takes/upload-reservations/" + wav_reservation_id + "/finalize"
        )
        assert res_wav_reservation_id.status_code == 200

    finally:
        app.dependency_overrides.clear()


def test_finalize_safe_retry_idempotency(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-safe-retry-01",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=content,
            content_type="audio/webm",
        )

        reserved_upload_id = res_id
        # First finalize
        res_fin_1 = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin_1.status_code == 200
        take_1 = res_fin_1.json()["data"]

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == size

        # Client timeout / network error retry finalize with identical client_request_id
        res_fin_2 = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin_2.status_code == 200
        take_2 = res_fin_2.json()["data"]
        assert take_2["take_id"] == take_1["take_id"]

        # Quota used_bytes must NOT be doubled
        session.refresh(account)
        assert account.used_bytes == size

        # Exactly 1 take row exists in DB
        takes = (
            session.execute(select(PerformanceTake).where(PerformanceTake.take_uuid == take_id))
            .scalars()
            .all()
        )
        assert len(takes) == 1

    finally:
        app.dependency_overrides.clear()


def test_finalize_recovers_first_post_storage_db_disconnect(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    original_get = AsyncSessionAdapter.get
    first_score_read = {"pending": True}

    async def disconnect_once(self, model, identity):  # type: ignore[no-untyped-def]
        if model is Score and first_score_read["pending"]:
            first_score_read["pending"] = False
            raise DBAPIError.instance(
                "SELECT score",
                {},
                Exception("connection is closed"),
                Exception,
                connection_invalidated=True,
            )
        return await original_get(self, model, identity)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {
                "kind": "VIDEO",
                "byte_size": len(content),
                "mime_type": "video/webm",
                "duration_ms": 5000,
            },
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-post-storage-disconnect",
        }
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json=auth_req,
        )
        assert res_auth.status_code == 200, res_auth.text
        auth_data = res_auth.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=content,
            content_type="video/webm",
        )

        reserved_upload_id = auth_data["reservation_id"]
        with patch.object(AsyncSessionAdapter, "get", new=disconnect_once):
            res_fin = client.post(
                "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
            )

        assert res_fin.status_code == 200, res_fin.text
        assert first_score_read["pending"] is False
        assert (
            session.execute(
                select(PerformanceTake).where(PerformanceTake.take_uuid == auth_data["take_id"])
            )
            .scalars()
            .one()
        )
        account = session.get(StorageUsageAccount, user_1.id)
        session.refresh(account)
        assert account.used_bytes == len(content)
        assert account.reserved_bytes == 0
    finally:
        app.dependency_overrides.clear()


def test_finalize_range_video_preserves_scope_identity_and_recording_timebase(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)
    try:
        content = VALID_WEBM_BYTES
        recording_timebase = {
            "nominalMediaDurationMs": 5000,
            "activeSegments": [
                {
                    "perfStartMs": 0,
                    "perfEndMs": 5000,
                    "mediaStartMs": 0,
                    "mediaEndMs": 5000,
                }
            ],
        }
        tempo_plan = {
            "selection": {"mode": "SCORE"},
            "segments": [{"startBeat": 0, "bpm": 96, "source": "MUSICXML"}],
        }
        request = {
            "source": {
                "score_id": "score-uuid-10",
                "revision_id": "revision-uuid-100",
                "artifact_id": "art-1",
            },
            "media": {
                "kind": "VIDEO",
                "byte_size": len(content),
                "mime_type": "video/webm",
                "duration_ms": 5000,
            },
            "scope": {
                "kind": "RANGE",
                "start_beat": 4,
                "terminal_beat": 8,
                "start_group_id": "group-2",
                "end_group_id": "group-4",
            },
            "client_request_id": "req-range-video-scope-identity",
            "tempo_plan": tempo_plan,
            "recording_timebase": recording_timebase,
        }
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json=request,
        )
        assert res_auth.status_code == 200, res_auth.text
        auth_data = res_auth.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=content,
            content_type="video/webm",
        )

        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/"
            + auth_data["reservation_id"]
            + "/finalize"
        )
        assert res_fin.status_code == 200, res_fin.text
        take_data = res_fin.json()["data"]
        assert take_data["scope_type"] == "RANGE"
        assert take_data["scope_start_beat"] == 4
        assert take_data["scope_terminal_beat"] == 8
        assert take_data["scope_start_group_id"] == "group-2"
        assert take_data["scope_end_group_id"] == "group-4"
        assert "scopeIdentity" not in take_data["recording_timebase"]
        assert take_data["tempo_plan"] == tempo_plan
        assert session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == auth_data["take_id"])
        ).scalar_one()
    finally:
        app.dependency_overrides.clear()


def test_finalize_rejects_candidate_when_staging_changes_after_validation(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()

    first_content = b"\x1a\x45\xdf\xa3" + b"A" * 32
    rewritten_content = b"\x1a\x45\xdf\xa3" + b"B" * 32
    assert len(first_content) == len(rewritten_content)

    class MutatingCopyStorage(LocalFileStorage):
        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)

        def copy(self, source_key: str, target_key: str) -> None:
            self.put_bytes(
                key=source_key,
                content=rewritten_content,
                content_type="audio/webm",
            )
            super().copy(source_key, target_key)

    mutating_storage = MutatingCopyStorage(storage)
    mutating_storage.upload_url = storage.upload_url  # type: ignore[assignment]
    take_svc = _performance_take_service(
        storage=mutating_storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: mutating_storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {
                "byte_size": len(first_content),
                "mime_type": "audio/webm",
                "duration_ms": 5000,
            },
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-staging-rewrite",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=first_content,
            content_type="audio/webm",
        )

        reserved_upload_id = auth_data["reservation_id"]
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 422
        assert (
            session.execute(
                select(PerformanceTake).where(PerformanceTake.take_uuid == auth_data["take_id"])
            ).scalar_one_or_none()
            is None
        )

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == 0
        assert account.reserved_bytes == len(first_content)
    finally:
        app.dependency_overrides.clear()


def test_video_take_finalize_uses_video_media_kind_and_candidate(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = b"\x1a\x45\xdf\xa3" + b"fake-browser-video-with-audio"
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {
                "kind": "VIDEO",
                "byte_size": len(content),
                "mime_type": "video/webm",
                "duration_ms": 5000,
            },
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-video-save",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200, res_auth.text
        auth_data = res_auth.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=content,
            content_type="video/webm",
        )

        reserved_upload_id = auth_data["reservation_id"]
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200, res_fin.text
        take_data = res_fin.json()["data"]
        assert take_data["media_kind"] == "VIDEO"
        assert take_data["media_mime_type"] == "video/webm"

        take_row = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == auth_data["take_id"])
        ).scalar_one()
        assert take_row.media_kind == PerformanceTakeMediaKind.VIDEO
        assert take_row.media_object_key.endswith(".webm")
        assert storage.exists(take_row.media_object_key)
        assert b"fake-browser-video-with-audio" in b"".join(
            storage.iter_bytes(take_row.media_object_key)
        )

        res_playback = client.get(f"/api/v1/performance-takes/{take_data['take_id']}/playback-url")
        assert res_playback.status_code == 200
        playback_data = res_playback.json()["data"]
        assert playback_data["media_kind"] == "VIDEO"
        assert playback_data["media_mime_type"] == "video/webm"

        conflict_req = {**auth_req, "media_kind": "AUDIO"}
        res_conflict = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json=conflict_req,
        )
        assert res_conflict.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_reserve_finalizing_snapshot_retries_without_new_put(test_env):
    session, _storage, user_1, _ = test_env
    source = _create_default_source(session, _storage)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    auth = PerformanceTakeUploadReservation(
        user_id=user_1.id,
        practice_source_id=source.id,
        client_request_id="req-finalizing-reserve",
        take_uuid="take-finalizing-reserve",
        score_id=10,
        score_uuid="score-uuid-10",
        score_title="Moonlight Sonata",
        revision_id=100,
        revision_uuid=DEFAULT_TAKE_REVISION_ID,
        artifact_id=DEFAULT_TAKE_ARTIFACT_ID,
        scope_type="FULL",
        scope_start_beat=0.0,
        scope_terminal_beat=4.0,
        duration_ms=1000,
        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        storage_backend="local",
        staging_object_key="staging/performance-takes/1/finalizing-reserve/recording.webm",
        final_object_key="performance-takes/1/finalizing-reserve/token.webm",
        finalizing_object_key="performance-takes/1/finalizing-reserve/token.webm",
        storage_reservation_id="reservation-finalizing-reserve",
        status=PerformanceTakeUploadReservationStatus.FINALIZING,
        expires_at=now + timedelta(minutes=10),
        last_put_url_expires_at=now + timedelta(minutes=10),
        staging_cleanup_after=now + timedelta(minutes=10),
        finalizing_token="token",
        finalizing_expires_at=now + timedelta(minutes=10),
    )
    session.add(auth)
    session.commit()

    take_svc = _performance_take_service(storage=_storage)
    response = _run_async(
        take_svc.reserve_upload(
            AsyncSessionAdapter(session),
            user_1.id,
            PerformanceTakeUploadReservationRequest.model_validate(
                _reservation_request_payload(
                    {
                        "source": {"score_id": "score-uuid-10"},
                        "client_request_id": "req-finalizing-reserve",
                        "media": {
                            "byte_size": len(VALID_WEBM_BYTES),
                            "mime_type": "audio/webm",
                            "duration_ms": 1000,
                        },
                        "scope": {"start_beat": 0, "terminal_beat": 4},
                    }
                )
            ),
        )
    )
    assert response.status == "FINALIZING"
    assert response.upload_target is None
    assert response.reservation_id == auth.reservation_uuid
    assert response.reservation_id != auth.storage_reservation_id


def test_crash_abandoned_after_reservation(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "source": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
            },
            "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-abandoned-01",
            "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        staging_key = _staging_key(session, auth_data["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == size

        # Simulate time passing and reservation expiring
        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-abandoned-01"
            )
        ).scalar_one()
        practice_source_id = auth.practice_source_id
        source = session.get(PracticeSourceRecord, practice_source_id)
        assert source is not None
        musicxml_key = source.prepared_musicxml_object_key
        artifact_key = source.artifact_object_key
        auth.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()

        # Background maintenance task cleans expired reservations
        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_reservations(
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
        assert auth.status == PerformanceTakeUploadReservationStatus.EXPIRED
        assert auth.practice_source_id is None
        assert session.execute(select(PracticeSourceDeleteOutbox).where(
            PracticeSourceDeleteOutbox.practice_source_id == practice_source_id
        )).scalar_one_or_none() is None
        retained = session.get(PracticeSourceRecord, practice_source_id)
        session.refresh(retained)
        assert retained.status == PracticeSourceStatus.READY.value
        assert retained.live_revision_id == 100
        assert storage.exists(musicxml_key)
        assert storage.exists(artifact_key)

    finally:
        app.dependency_overrides.clear()


def test_expired_reservation_staging_delete_failure_is_retryable(test_env, monkeypatch):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        size = len(VALID_WEBM_BYTES)
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "source": {"score_id": "score-uuid-10"},
                "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
                "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": "req-expired-delete-retry",
            },
        )
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=VALID_WEBM_BYTES,
            content_type="audio/webm",
        )

        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-expired-delete-retry"
            )
        ).scalar_one()
        auth.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()

        original_delete = storage.delete

        def fail_delete(_key: str) -> bool:
            raise RuntimeError("storage temporarily unavailable")

        monkeypatch.setattr(storage, "delete", fail_delete)
        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert storage.exists(auth.staging_object_key)
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.reserved_bytes == 0
        session.refresh(auth)
        assert auth.status == PerformanceTakeUploadReservationStatus.EXPIRED

        monkeypatch.setattr(storage, "delete", original_delete)
        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert not storage.exists(auth.staging_object_key)
    finally:
        app.dependency_overrides.clear()


def test_archived_reservation_late_staging_put_is_cleaned_after_expiry(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "source": {"score_id": "score-uuid-10"},
                "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
                "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": "req-late-put-cleanup",
            },
        )
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        staging_key = _staging_key(session, auth_data["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/"
            + auth_data["reservation_id"]
            + "/finalize"
        )
        assert res_fin.status_code == 200

        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-late-put-cleanup"
            )
        ).scalar_one()
        final_bytes = storage.read_bytes(auth.final_object_key)

        # A still-valid old presigned PUT can recreate staging after the successful save.
        storage.put_bytes(
            key=staging_key,
            content=b"\x1a\x45\xdf\xa3late-staging-rewrite",
            content_type="audio/webm",
        )
        assert storage.exists(staging_key)

        auth.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()
        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert not storage.exists(staging_key)
        assert storage.read_bytes(auth.final_object_key) == final_bytes
        session.refresh(auth)
        assert auth.status == PerformanceTakeUploadReservationStatus.COMPLETED
    finally:
        app.dependency_overrides.clear()


def test_score_deleted_between_auth_and_finalize_uses_durable_source(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "source": {"score_id": "score-uuid-10", "revision_id": "revision-uuid-100"},
            "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-score-del-midway",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        staging_key = _staging_key(session, auth_data["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        # Simulate score becoming unavailable before client calls finalize. The
        # upload reservation already references the durable source, so this
        # save must still finish without requiring live Score access.
        session.execute(text("UPDATE scores SET deletion_status = 'DELETED' WHERE id = 10;"))
        session.commit()

        reserved_upload_id = res_id
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200, res_fin.text
        data = res_fin.json()["data"]
        assert data["take_id"] == take_id
        assert data["source_score_id"] == "score-uuid-10"
        assert data["source_revision_id"] == "revision-uuid-100"
        assert data["source_artifact_id"] == DEFAULT_TAKE_ARTIFACT_ID
        assert data["linked_score_id"] is None
        assert data["can_open_score"] is False

        take = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one()
        source = session.get(PracticeSourceRecord, take.practice_source_id)
        assert source is not None
        assert source.source_score_uuid == "score-uuid-10"
        assert source.source_revision_uuid == "revision-uuid-100"
        assert storage.exists(source.prepared_musicxml_object_key)
        assert storage.exists(source.artifact_object_key)

        source = client.get(
            f"/api/v1/performance-takes/{take_id}/practice-source?include_notation=true"
        )
        assert source.status_code == 200, source.text
        assert source.json()["data"]["artifact"]["revisionId"] == DEFAULT_TAKE_REVISION_ID
        assert source.json()["data"]["artifact"]["artifactId"] == DEFAULT_TAKE_ARTIFACT_ID
        assert "<score-partwise" in source.json()["data"]["notation"]["musicxml"]

        # List takes exposes the durable historical source, but no live score link.
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        item = res_list.json()["data"]["items"][0]
        assert item["source_score_id"] == "score-uuid-10"
        assert item["linked_score_id"] is None

    finally:
        app.dependency_overrides.clear()


def test_deletion_lifecycle_and_worker_retry(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "source": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
            },
            "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-del-retry",
            "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=content,
            content_type="audio/webm",
        )

        reserved_upload_id = res_id
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200
        auth_row = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.take_uuid == take_id
            )
        ).scalar_one()
        assert auth_row.status == PerformanceTakeUploadReservationStatus.COMPLETED
        assert auth_row.practice_source_id is None
        take_row = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one()
        practice_source_id = take_row.practice_source_id
        source = session.get(PracticeSourceRecord, practice_source_id)
        assert source is not None
        musicxml_key = source.prepared_musicxml_object_key
        artifact_key = source.artifact_object_key
        assert storage.exists(musicxml_key)
        assert storage.exists(artifact_key)

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
        failing_res = _run_worker_deletion(
            monkeypatch, session, failing_storage, outbox.outbox_uuid
        )
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
        outbox.next_attempt_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
            seconds=1
        )
        session.commit()
        ok_res = _run_worker_deletion(monkeypatch, session, storage, outbox.outbox_uuid)
        assert ok_res["status"] == "deleted"

        # Outbox marked COMPLETED
        session.refresh(outbox)
        assert outbox.status == PerformanceTakeDeleteOutboxStatus.COMPLETED

        # Take deleted, quota released
        assert (
            session.execute(
                select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
            ).scalar_one_or_none()
            is None
        )
        session.refresh(account)
        assert account.used_bytes == 0
        assert session.execute(select(PracticeSourceDeleteOutbox).where(
            PracticeSourceDeleteOutbox.practice_source_id == practice_source_id
        )).scalar_one_or_none() is None
        retained = session.get(PracticeSourceRecord, practice_source_id)
        session.refresh(retained)
        assert retained.status == PracticeSourceStatus.READY.value
        assert retained.live_revision_id == 100
        assert storage.exists(musicxml_key)
        assert storage.exists(artifact_key)

    finally:
        app.dependency_overrides.clear()


def test_source_delete_outbox_retries_transient_storage_failure(
    test_env,
    monkeypatch: pytest.MonkeyPatch,
):
    session, storage, _user_1, _ = test_env
    source = _create_default_source(session, storage)
    practice_source_id = source.id
    musicxml_key = source.prepared_musicxml_object_key
    artifact_key = source.artifact_object_key
    outbox = practice_source_delete_service.enqueue_if_unowned(
        session,
        practice_source_id,
        storage_backend=storage.backend_name,
    )
    session.commit()
    assert outbox is not None

    class FailingSnapshotStorage(LocalFileStorage):
        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)

        def delete(self, key: str) -> bool:
            if key == musicxml_key:
                raise ConnectionError("source object store timeout")
            return super().delete(key)

    failed = _run_source_deletion(
        monkeypatch,
        session,
        FailingSnapshotStorage(storage),
        outbox.outbox_uuid,
    )
    assert failed["status"] == "failed"
    session.refresh(outbox)
    assert outbox.status == PracticeSourceDeleteOutboxStatus.FAILED
    assert "source object store timeout" in (outbox.last_error or "")
    assert session.get(PracticeSourceRecord, practice_source_id) is not None
    assert storage.exists(musicxml_key)
    assert storage.exists(artifact_key)

    outbox.next_attempt_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
    session.commit()
    succeeded = _run_source_deletion(
        monkeypatch,
        session,
        storage,
        outbox.outbox_uuid,
    )
    assert succeeded["status"] == "deleted"
    session.refresh(outbox)
    assert outbox.status == PracticeSourceDeleteOutboxStatus.COMPLETED
    assert session.get(PracticeSourceRecord, practice_source_id) is None
    assert not storage.exists(musicxml_key)
    assert not storage.exists(artifact_key)


def test_source_gc_marks_snapshot_deleting_until_completed(test_env):
    session, storage, _user_1, _ = test_env
    source = _create_default_source(session, storage)
    practice_source_id = source.id

    outbox = practice_source_delete_service.enqueue_if_unowned(
        session,
        practice_source_id,
        storage_backend=storage.backend_name,
    )
    session.commit()

    assert outbox is not None
    session.refresh(source)
    assert source.status == PracticeSourceStatus.DELETING.value


def test_source_creation_storage_failure_has_durable_cleanup(
    test_env,
    monkeypatch: pytest.MonkeyPatch,
):
    session, storage, user_1, _ = test_env

    class ArtifactWriteFailsStorage(LocalFileStorage):
        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)

        def upload_url(
            self,
            key: str,
            *,
            content_type: str,
            checksum_sha256: str = "",
        ) -> DirectUploadTarget:
            return DirectUploadTarget(
                upload_url=f"https://oss.example.com/{key}",
                upload_method="PUT",
                upload_headers={"content-type": content_type},
            )

        def put_bytes(self, *, key: str, content: bytes, content_type: str) -> None:
            if key.endswith("/artifact.json"):
                raise ConnectionError("artifact source write failed")
            super().put_bytes(key=key, content=content, content_type=content_type)

    failing_storage = ArtifactWriteFailsStorage(storage)
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        storage=failing_storage,
        storage_usage_service=storage_usage_svc,
    )

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user_1
    app.dependency_overrides[get_file_storage] = lambda: failing_storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)
    try:
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "source": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
                },
                "media": {
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                    "duration_ms": 5000,
                },
                "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": "req-source-create-storage-fail",
                "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            },
        )
        assert res_auth.status_code >= 400

        source = session.execute(select(PracticeSourceRecord)).scalar_one()
        assert source.status == PracticeSourceStatus.DELETING.value
        assert source.live_revision_id is None
        assert storage.exists(source.prepared_musicxml_object_key)
        assert not storage.exists(source.artifact_object_key)
        outbox = session.execute(
            select(PracticeSourceDeleteOutbox).where(
                PracticeSourceDeleteOutbox.practice_source_id == source.id
            )
        ).scalar_one()
        assert outbox.status == PracticeSourceDeleteOutboxStatus.PENDING

        result = _run_source_deletion(
            monkeypatch,
            session,
            storage,
            outbox.outbox_uuid,
        )
        assert result["status"] == "deleted"
        assert session.get(PracticeSourceRecord, source.id) is None
        assert not storage.exists(source.prepared_musicxml_object_key)
        assert not storage.exists(source.artifact_object_key)
    finally:
        app.dependency_overrides.clear()


def test_stale_creating_snapshot_recovery_cleans_partial_objects(
    test_env,
    monkeypatch: pytest.MonkeyPatch,
):
    session, storage, _user_1, _ = test_env
    expired_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
    variants = [
        ("none", False, False),
        ("musicxml", True, False),
        ("both", True, True),
    ]
    for label, has_musicxml, has_artifact in variants:
        musicxml_key = f"practice-sources/stale-{label}/score.musicxml"
        artifact_key = f"practice-sources/stale-{label}/artifact.json"
        if has_musicxml:
            storage.put_bytes(
                key=musicxml_key,
                content=b"<score-partwise />",
                content_type="application/vnd.recordare.musicxml+xml",
            )
        if has_artifact:
            storage.put_bytes(
                key=artifact_key,
                content=b"{}",
                content_type="application/json",
            )
        source = PracticeSourceRecord(
            source_id=f"stale-{label}",
            live_revision_id=100,
            source_score_uuid="score-uuid-10",
            source_revision_uuid=DEFAULT_TAKE_REVISION_ID,
            artifact_id=f"{DEFAULT_TAKE_ARTIFACT_ID}-{label}",
            artifact_schema_version=1,
            prepared_musicxml_object_key=musicxml_key,
            prepared_musicxml_sha256=hashlib.sha256(b"<score-partwise />").hexdigest(),
            prepared_musicxml_byte_size=len(b"<score-partwise />"),
            artifact_object_key=artifact_key,
            artifact_sha256=hashlib.sha256(b"{}").hexdigest(),
            artifact_byte_size=len(b"{}"),
            status=PracticeSourceStatus.CREATING.value,
            creation_expires_at=expired_at,
        )
        session.add(source)
        session.flush()

    due = practice_source_delete_service.recover_stale_creating(
        session,
        storage_backend=storage.backend_name,
    )
    session.commit()
    assert len(due) == len(variants)

    for outbox_uuid in due:
        result = _run_source_deletion(monkeypatch, session, storage, outbox_uuid)
        assert result["status"] == "deleted"

    assert session.execute(select(PracticeSourceRecord)).scalars().all() == []
    for label, _has_musicxml, _has_artifact in variants:
        assert not storage.exists(f"practice-sources/stale-{label}/score.musicxml")
        assert not storage.exists(f"practice-sources/stale-{label}/artifact.json")


def test_reservation_rejects_source_pending_gc(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)
    try:
        first_response = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "source": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
                },
                "media": {
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                    "duration_ms": 5000,
                },
                "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": "req-source-pending-gc-first",
                "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            },
        )
        assert first_response.status_code == 200
        reservation_id = first_response.json()["data"]["reservation_id"]
        cancel_response = client.delete(
            f"/api/v1/performance-takes/upload-reservations/{reservation_id}"
        )
        assert cancel_response.status_code == 200
        source = session.execute(select(PracticeSourceRecord)).scalar_one()
        session.refresh(source)
        assert source.status == PracticeSourceStatus.READY.value
        source.status = PracticeSourceStatus.DELETING.value
        session.commit()

        response = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "source": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
                },
                "media": {
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                    "duration_ms": 5000,
                },
                "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": "req-source-pending-gc",
                "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            },
        )
        assert response.status_code >= 400
        rejected_auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-source-pending-gc"
            )
        ).scalar_one_or_none()
        assert rejected_auth is None
    finally:
        app.dependency_overrides.clear()


def test_reservation_creator_cannot_ready_source_after_stale_recovery(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    original_put_bytes = storage.put_bytes
    put_count = 0

    def put_bytes_with_stale_recovery(*, key: str, content: bytes, content_type: str | None = None):
        nonlocal put_count
        stored = original_put_bytes(key=key, content=content, content_type=content_type)
        if key.startswith("practice-sources/"):
            put_count += 1
        if put_count == 2:
            source = session.execute(select(PracticeSourceRecord)).scalar_one()
            source.status = PracticeSourceStatus.DELETING.value
            source.creation_expires_at = None
            session.add(
                PracticeSourceDeleteOutbox(
                    practice_source_id=source.id,
                    source_id=source.source_id,
                    storage_backend=storage.backend_name,
                    prepared_musicxml_object_key=source.prepared_musicxml_object_key,
                    artifact_object_key=source.artifact_object_key,
                    status=PracticeSourceDeleteOutboxStatus.PENDING.value,
                    max_attempts=5,
                )
            )
            session.commit()
        return stored

    storage.put_bytes = put_bytes_with_stale_recovery  # type: ignore[assignment]
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)
    try:
        response = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "source": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
                },
                "media": {
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                    "duration_ms": 5000,
                },
                "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": "req-source-stale-creator",
                "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            },
        )
        assert response.status_code >= 400
        source = session.execute(select(PracticeSourceRecord)).scalar_one()
        assert source.status == PracticeSourceStatus.DELETING.value
        assert source.creation_expires_at is None
        assert (
            session.execute(
                select(PerformanceTakeUploadReservation).where(
                    PerformanceTakeUploadReservation.client_request_id
                    == "req-source-stale-creator"
                )
            ).scalar_one_or_none()
            is None
        )
        outboxes = session.execute(select(PracticeSourceDeleteOutbox)).scalars().all()
        assert len(outboxes) == 1
    finally:
        storage.put_bytes = original_put_bytes  # type: ignore[assignment]
        app.dependency_overrides.clear()


def test_source_gc_does_not_restore_ready_if_reference_appears_before_claim(test_env):
    session, storage, user_1, _ = test_env
    source = _create_default_source(session, storage)
    practice_source_id = source.id
    outbox = practice_source_delete_service.enqueue_if_unowned(
        session,
        practice_source_id,
        storage_backend=storage.backend_name,
    )
    assert outbox is not None
    session.flush()

    auth = PerformanceTakeUploadReservation(
        user_id=user_1.id,
        practice_source_id=practice_source_id,
        client_request_id="req-source-gc-race",
        take_uuid="take-source-gc-race",
        score_id=None,
        score_uuid="score-uuid-10",
        score_title="Moonlight Sonata",
        revision_id=None,
        revision_uuid=DEFAULT_TAKE_REVISION_ID,
        artifact_id=DEFAULT_TAKE_ARTIFACT_ID,
        scope_type="FULL",
        scope_start_beat=0.0,
        scope_terminal_beat=4.0,
        scope_start_group_id=None,
        scope_end_group_id=None,
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        duration_ms=5000,
        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        storage_backend=storage.backend_name,
        staging_object_key="performance-takes/staging/gc-race.webm",
        final_object_key="performance-takes/final/gc-race.webm",
        storage_reservation_id="reservation-gc-race",
        status=PerformanceTakeUploadReservationStatus.RESERVED.value,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=5),
        last_put_url_expires_at=datetime.now(timezone.utc).replace(tzinfo=None)
        + timedelta(minutes=5),
        staging_cleanup_after=datetime.now(timezone.utc).replace(tzinfo=None)
        + timedelta(minutes=5),
    )
    session.add(auth)
    session.commit()

    payload = practice_source_delete_service.claim(session, outbox.outbox_uuid)
    session.commit()

    assert payload is None
    session.refresh(source)
    session.refresh(outbox)
    assert source.status == PracticeSourceStatus.DELETING.value
    assert outbox.status == PracticeSourceDeleteOutboxStatus.COMPLETED.value
    assert storage.exists(source.prepared_musicxml_object_key)
    assert storage.exists(source.artifact_object_key)


def test_source_worker_preserves_objects_if_reference_appears_after_claim(
    test_env,
    monkeypatch,
):
    session, storage, user_1, _ = test_env
    source = _create_default_source(session, storage)
    outbox = practice_source_delete_service.enqueue_if_unowned(
        session,
        source.id,
        storage_backend=storage.backend_name,
    )
    assert outbox is not None
    session.commit()

    original_claim = practice_source_delete_service.claim

    def claim_then_reference(db, outbox_uuid):
        payload = original_claim(db, outbox_uuid)
        auth = PerformanceTakeUploadReservation(
            user_id=user_1.id,
            practice_source_id=source.id,
            client_request_id="req-source-active-ref-after-delete",
            take_uuid="take-source-active-ref-after-delete",
            score_id=None,
            score_uuid="score-uuid-10",
            score_title="Moonlight Sonata",
            revision_id=None,
            revision_uuid=DEFAULT_TAKE_REVISION_ID,
            artifact_id=DEFAULT_TAKE_ARTIFACT_ID,
            scope_type="FULL",
            scope_start_beat=0.0,
            scope_terminal_beat=4.0,
            scope_start_group_id=None,
            scope_end_group_id=None,
            tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
            recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
            duration_ms=5000,
            media_kind="AUDIO",
            media_mime_type="audio/webm",
            media_byte_size=len(VALID_WEBM_BYTES),
            storage_backend=storage.backend_name,
            staging_object_key="performance-takes/staging/active-ref-after-delete.webm",
            final_object_key="performance-takes/final/active-ref-after-delete.webm",
            storage_reservation_id="reservation-active-ref-after-delete",
            status=PerformanceTakeUploadReservationStatus.RESERVED.value,
            expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=5),
            last_put_url_expires_at=datetime.now(timezone.utc).replace(tzinfo=None)
            + timedelta(minutes=5),
            staging_cleanup_after=datetime.now(timezone.utc).replace(tzinfo=None)
            + timedelta(minutes=5),
        )
        session.add(auth)
        session.commit()
        return payload

    with patch.object(practice_source_delete_service, "claim", side_effect=claim_then_reference):
        result = _run_source_deletion(monkeypatch, session, storage, outbox.outbox_uuid)
    assert result["status"] == "failed"
    session.refresh(source)
    session.refresh(outbox)
    assert source.status == PracticeSourceStatus.DELETING.value
    assert outbox.status == PracticeSourceDeleteOutboxStatus.FAILED.value
    assert "invariant violated" in (outbox.last_error or "")
    assert storage.exists(source.prepared_musicxml_object_key)
    assert storage.exists(source.artifact_object_key)


def test_source_gc_enqueued_once_after_last_take_reference_deleted(test_env, monkeypatch):
    session, storage, user_1, _ = test_env
    source = _create_default_source(session, storage)
    first_key = "performance-takes/final/gc-last-ref/first.webm"
    second_key = "performance-takes/final/gc-last-ref/second.webm"
    storage.put_bytes(key=first_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    storage.put_bytes(key=second_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    first_take = _create_default_take(
        session,
        user_id=user_1.id,
        practice_source_id=source.id,
        client_request_id="gc-last-ref-first",
        take_uuid="take-gc-last-ref-first",
        media_object_key=first_key,
    )
    second_take = _create_default_take(
        session,
        user_id=user_1.id,
        practice_source_id=source.id,
        client_request_id="gc-last-ref-second",
        take_uuid="take-gc-last-ref-second",
        media_object_key=second_key,
    )
    first_outbox = _create_take_delete_outbox(session, first_take)
    second_outbox = _create_take_delete_outbox(session, second_take)
    session.commit()

    first_result = _run_worker_deletion(monkeypatch, session, storage, first_outbox.outbox_uuid)
    assert first_result["status"] == "deleted"
    assert session.get(PracticeSourceRecord, source.id) is not None
    assert (
        session.execute(
            select(PracticeSourceDeleteOutbox).where(
                PracticeSourceDeleteOutbox.practice_source_id == source.id
            )
        ).scalar_one_or_none()
        is None
    )

    second_result = _run_worker_deletion(monkeypatch, session, storage, second_outbox.outbox_uuid)
    assert second_result["status"] == "deleted"
    session.refresh(source)
    assert source.status == PracticeSourceStatus.DELETING.value
    source_outboxes = (
        session.execute(
            select(PracticeSourceDeleteOutbox).where(
                PracticeSourceDeleteOutbox.practice_source_id == source.id
            )
        )
        .scalars()
        .all()
    )
    assert len(source_outboxes) == 1

    duplicate = practice_source_delete_service.enqueue_if_unowned(
        session,
        source.id,
        storage_backend=storage.backend_name,
    )
    assert duplicate is not None
    assert duplicate.id == source_outboxes[0].id
    session.commit()

    source_result = _run_source_deletion(
        monkeypatch,
        session,
        storage,
        source_outboxes[0].outbox_uuid,
    )
    assert source_result["status"] == "deleted"
    assert session.get(PracticeSourceRecord, source.id) is None
    assert not storage.exists(source.prepared_musicxml_object_key)
    assert not storage.exists(source.artifact_object_key)


def test_source_gc_waits_for_active_reservation_after_last_take_deleted(test_env, monkeypatch):
    session, storage, user_1, _ = test_env
    source = _create_default_source(session, storage)
    media_key = "performance-takes/final/gc-active-auth/take.webm"
    storage.put_bytes(key=media_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    take = _create_default_take(
        session,
        user_id=user_1.id,
        practice_source_id=source.id,
        client_request_id="gc-active-auth-take",
        take_uuid="take-gc-active-auth",
        media_object_key=media_key,
    )
    auth = PerformanceTakeUploadReservation(
        user_id=user_1.id,
        practice_source_id=source.id,
        client_request_id="gc-active-auth",
        take_uuid="take-gc-active-auth-pending",
        score_id=None,
        score_uuid="score-uuid-10",
        score_title="Moonlight Sonata",
        revision_id=None,
        revision_uuid=DEFAULT_TAKE_REVISION_ID,
        artifact_id=DEFAULT_TAKE_ARTIFACT_ID,
        scope_type="FULL",
        scope_start_beat=0.0,
        scope_terminal_beat=4.0,
        scope_start_group_id=None,
        scope_end_group_id=None,
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        duration_ms=5000,
        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        storage_backend=storage.backend_name,
        staging_object_key="performance-takes/staging/gc-active-auth.webm",
        final_object_key="performance-takes/final/gc-active-auth.webm",
        storage_reservation_id="reservation-gc-active-auth",
        status=PerformanceTakeUploadReservationStatus.RESERVED.value,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=5),
        last_put_url_expires_at=datetime.now(timezone.utc).replace(tzinfo=None)
        + timedelta(minutes=5),
        staging_cleanup_after=datetime.now(timezone.utc).replace(tzinfo=None)
        + timedelta(minutes=5),
    )
    session.add(auth)
    take_outbox = _create_take_delete_outbox(session, take)
    session.commit()

    take_result = _run_worker_deletion(monkeypatch, session, storage, take_outbox.outbox_uuid)
    assert take_result["status"] == "deleted"
    session.refresh(source)
    assert source.status == PracticeSourceStatus.READY.value
    assert (
        session.execute(
            select(PracticeSourceDeleteOutbox).where(
                PracticeSourceDeleteOutbox.practice_source_id == source.id
            )
        ).scalar_one_or_none()
        is None
    )

    auth.status = PerformanceTakeUploadReservationStatus.CANCELLED
    auth.practice_source_id = None
    session.flush()
    outbox = practice_source_delete_service.enqueue_if_unowned(
        session,
        source.id,
        storage_backend=storage.backend_name,
    )
    assert outbox is not None
    session.commit()

    source_result = _run_source_deletion(monkeypatch, session, storage, outbox.outbox_uuid)
    assert source_result["status"] == "deleted"
    assert session.get(PracticeSourceRecord, source.id) is None


def test_reserve_does_not_reuse_source_pending_gc(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)
    try:
        base_request = {
            "source": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "artifact_id": DEFAULT_TAKE_ARTIFACT_ID,
            },
            "media": {
                "byte_size": len(VALID_WEBM_BYTES),
                "mime_type": "audio/webm",
                "duration_ms": 5000,
            },
            "scope": {"kind": "FULL", "start_beat": 0.0, "terminal_beat": 4.0},
            "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        first = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                **base_request,
                "client_request_id": "req-source-source-created",
            },
        )
        assert first.status_code == 200, first.text
        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-source-source-created"
            )
        ).scalar_one()
        source = session.get(PracticeSourceRecord, auth.practice_source_id)
        assert source is not None
        auth.status = PerformanceTakeUploadReservationStatus.CANCELLED.value
        auth.practice_source_id = None
        source.status = PracticeSourceStatus.DELETING.value
        session.commit()

        res = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                **base_request,
                "client_request_id": "req-source-source-not-ready",
            },
        )
        assert res.status_code != 200
        assert (
            session.execute(
                select(PerformanceTakeUploadReservation).where(
                    PerformanceTakeUploadReservation.client_request_id
                    == "req-source-source-not-ready"
                )
            ).scalar_one_or_none()
            is None
        )
        session.refresh(source)
        assert source.status == PracticeSourceStatus.DELETING.value
    finally:
        app.dependency_overrides.clear()


def test_delete_outbox_late_fail_cannot_overwrite_completed_attempt(test_env):
    session, _storage, user_1, _ = test_env
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    outbox = PerformanceTakeDeleteOutbox(
        outbox_uuid="outbox-late-fail-001",
        take_id=None,
        take_uuid="take-late-fail-001",
        user_id=user_1.id,
        storage_backend="local",
        object_key="performance-takes/1/take-late-fail-001/recording.webm",
        media_byte_size=123,
        status=PerformanceTakeDeleteOutboxStatus.PENDING,
        attempt_count=0,
        max_attempts=5,
        next_attempt_at=now,
    )
    session.add(outbox)
    session.commit()

    payload_a = performance_take_delete_outbox_service.claim(
        session,
        outbox.outbox_uuid,
    )
    assert payload_a is not None
    assert payload_a.attempt == 1
    session.commit()

    outbox.status = PerformanceTakeDeleteOutboxStatus.FAILED
    outbox.next_attempt_at = now - timedelta(seconds=1)
    outbox.last_error = "lease expired"
    session.commit()

    payload_b = performance_take_delete_outbox_service.claim(
        session,
        outbox.outbox_uuid,
    )
    assert payload_b is not None
    assert payload_b.attempt == 2
    session.commit()

    assert (
        performance_take_delete_outbox_service.complete(
            session,
            outbox.outbox_uuid,
            attempt=payload_b.attempt,
        )
        is True
    )
    session.commit()

    assert (
        performance_take_delete_outbox_service.complete(
            session,
            outbox.outbox_uuid,
            attempt=payload_a.attempt,
        )
        is False
    )
    session.commit()

    assert (
        performance_take_delete_outbox_service.fail(
            session,
            outbox.outbox_uuid,
            "stale worker failure",
            attempt=payload_a.attempt,
        )
        is False
    )
    session.commit()

    session.refresh(outbox)
    assert outbox.status == PerformanceTakeDeleteOutboxStatus.COMPLETED
    assert outbox.attempt_count == 2
    assert outbox.last_error is None


def test_expired_reservation_cleanup_releases_db_lock_before_storage_delete(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    class LockAssertingStorage(LocalFileStorage):
        backend_name = "local"

        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)

        def delete(self, key: str) -> bool:
            assert not session.in_transaction()
            return super().delete(key)

    try:
        size = len(VALID_WEBM_BYTES)
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "source": {"score_id": "score-uuid-10"},
                "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
                "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
                "client_request_id": "req-expired-no-lock-delete",
            },
        )
        assert res_auth.status_code == 200
        auth_data = res_auth.json()["data"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=VALID_WEBM_BYTES,
            content_type="audio/webm",
        )

        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-expired-no-lock-delete"
            )
        ).scalar_one()
        auth.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()

        cleaned_count = performance_take_delete_outbox_service.cleanup_expired_reservations(
            session,
            storage=LockAssertingStorage(storage),
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert not storage.exists(auth.staging_object_key)
        session.refresh(auth)
        assert auth.status == PerformanceTakeUploadReservationStatus.EXPIRED
    finally:
        app.dependency_overrides.clear()


def _expired_cleanup_auth(
    *,
    practice_source_id: int,
    user_id: int,
    client_request_id: str,
    staging_key: str,
    final_key: str,
) -> PerformanceTakeUploadReservation:
    expired_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
    return PerformanceTakeUploadReservation(
        user_id=user_id,
        practice_source_id=practice_source_id,
        client_request_id=client_request_id,
        take_uuid=f"take-{client_request_id}",
        score_id=10,
        score_uuid="score-uuid-10",
        score_title="Cleanup test",
        revision_id=100,
        revision_uuid=DEFAULT_TAKE_REVISION_ID,
        artifact_id=DEFAULT_TAKE_ARTIFACT_ID,
        scope_type="FULL",
        scope_start_beat=0.0,
        scope_terminal_beat=4.0,
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        duration_ms=1000,
        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        storage_backend="local",
        staging_object_key=staging_key,
        final_object_key=final_key,
        storage_reservation_id=f"reservation-{client_request_id}",
        status=PerformanceTakeUploadReservationStatus.EXPIRED,
        expires_at=expired_at,
        last_put_url_expires_at=expired_at,
        staging_cleanup_after=expired_at,
    )


def test_reservation_cleanup_does_not_complete_when_delete_returns_false(test_env):
    session, storage, user_1, _ = test_env
    staging_key = "staging/performance-takes/1/delete-false/recording.webm"
    final_key = "performance-takes/1/delete-false/recording.webm"
    storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="delete-false",
        staging_key=staging_key,
        final_key=final_key,
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    session.add(auth)
    session.commit()

    class DeleteFalseStorage(LocalFileStorage):
        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)

        def delete(self, key: str) -> bool:
            return False

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=DeleteFalseStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    assert storage.exists(staging_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is None


def test_reservation_cleanup_does_not_complete_when_head_still_exists(test_env):
    session, storage, user_1, _ = test_env
    staging_key = "staging/performance-takes/1/head-still-exists/recording.webm"
    final_key = "performance-takes/1/head-still-exists/recording.webm"
    storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="head-still-exists",
        staging_key=staging_key,
        final_key=final_key,
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    session.add(auth)
    session.commit()

    class DeleteLiesStorage(LocalFileStorage):
        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)

        def delete(self, key: str) -> bool:
            return True

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=DeleteLiesStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    assert storage.exists(staging_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is None


def test_reservation_cleanup_does_not_complete_when_final_head_fails(test_env):
    session, storage, user_1, _ = test_env
    staging_key = "staging/performance-takes/1/head-fails/recording.webm"
    final_key = "performance-takes/1/head-fails/recording.webm"
    storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="head-fails",
        staging_key=staging_key,
        final_key=final_key,
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    session.add(auth)
    session.commit()

    class HeadFailsAfterDeleteStorage(LocalFileStorage):
        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)
            self._deleted = False

        def delete(self, key: str) -> bool:
            self._deleted = True
            return super().delete(key)

        def exists(self, key: str) -> bool:
            if self._deleted and key == staging_key:
                raise RuntimeError("head temporarily unavailable")
            return super().exists(key)

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=HeadFailsAfterDeleteStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    assert not storage.exists(staging_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is None


def test_finalize_copy_lease_rejects_expired_executor_before_storage_copy(test_env):
    session, _storage, user_1, _ = test_env
    take_svc = _performance_take_service(storage=_storage)
    expired = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
    source = _create_default_source(session, _storage)
    auth = PerformanceTakeUploadReservation(
        user_id=user_1.id,
        practice_source_id=source.id,
        client_request_id="lease-expired-before-copy",
        take_uuid="take-lease-expired-before-copy",
        score_id=10,
        score_uuid="score-uuid-10",
        score_title="Lease test",
        revision_id=100,
        revision_uuid=DEFAULT_TAKE_REVISION_ID,
        artifact_id=DEFAULT_TAKE_ARTIFACT_ID,
        scope_type="FULL",
        scope_start_beat=0.0,
        scope_terminal_beat=4.0,
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        duration_ms=1000,
        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        storage_backend="local",
        staging_object_key="staging/performance-takes/1/lease-expired/recording.webm",
        final_object_key="performance-takes/1/lease-expired/recording.webm",
        storage_reservation_id="reservation-lease-expired",
        status=PerformanceTakeUploadReservationStatus.FINALIZING,
        expires_at=expired + timedelta(hours=2),
        finalizing_token="expired-token",
        finalizing_expires_at=expired,
    )
    session.add(auth)
    session.commit()

    with pytest.raises(Exception) as exc_info:
        _run_async(
            take_svc._ensure_finalize_copy_lease(
                AsyncSessionAdapter(session),
                user_id=user_1.id,
                take_uuid=auth.take_uuid,
                finalizing_token="expired-token",
            )
        )

    assert getattr(exc_info.value, "details", {}).get("reason") == "finalize_lease_lost"


def test_completed_reservation_cleanup_does_not_touch_storage(test_env):
    session, _storage, user_1, _ = test_env
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    past = now - timedelta(hours=2)
    source = _create_default_source(session, _storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="already-completed-cleanup",
        staging_key="staging/performance-takes/1/already-completed/recording.webm",
        final_key="performance-takes/1/already-completed/recording.webm",
    )
    auth.staging_cleanup_completed_at = past
    auth.final_cleanup_completed_at = past
    session.add(auth)
    session.commit()

    class FailsOnAccessStorage(LocalFileStorage):
        def exists(self, key: str) -> bool:
            raise AssertionError(f"storage should not be touched for {key}")

        def delete(self, key: str) -> bool:
            raise AssertionError(f"storage should not be touched for {key}")

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=FailsOnAccessStorage(),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 0


def test_reservation_cleanup_retries_orphan_final_without_touching_completed_staging(test_env):
    session, storage, user_1, _ = test_env
    orphan_key = "performance-takes/1/orphan-token/old-token.webm"
    storage.put_bytes(key=orphan_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="orphan-final-only",
        staging_key="staging/performance-takes/1/orphan-final-only/recording.webm",
        final_key="performance-takes/1/orphan-final-only/current.webm",
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    auth.staging_cleanup_completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    auth.final_cleanup_completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    auth.orphan_final_object_keys = f'["{orphan_key}"]'
    session.add(auth)
    session.commit()

    touched: list[str] = []

    class TrackingStorage(LocalFileStorage):
        def __init__(self, wrapped: LocalFileStorage) -> None:
            super().__init__(storage_root=wrapped.storage_root)

        def exists(self, key: str) -> bool:
            touched.append(f"exists:{key}")
            return super().exists(key)

        def delete(self, key: str) -> bool:
            touched.append(f"delete:{key}")
            return super().delete(key)

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=TrackingStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    assert not storage.exists(orphan_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is not None
    assert auth.final_cleanup_completed_at is not None
    assert auth.orphan_final_object_keys is None
    assert all(auth.staging_object_key not in item for item in touched)
    assert any(orphan_key in item for item in touched)


def test_reservation_cleanup_keeps_unknown_absent_orphan_until_grace_then_converges(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    orphan_key = "performance-takes/1/orphan-late/old-token.webm"
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="orphan-late-copy",
        staging_key="staging/performance-takes/1/orphan-late/recording.webm",
        final_key="performance-takes/1/orphan-late/current.webm",
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    auth.staging_cleanup_completed_at = now
    auth.final_cleanup_completed_at = now
    auth.orphan_final_object_keys = (
        f'[{{"key":"{orphan_key}","remove_after":"{(now + timedelta(minutes=10)).isoformat()}"}}]'
    )
    session.add(auth)
    session.commit()

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()
    assert cleaned == 1
    session.refresh(auth)
    assert orphan_key in (auth.orphan_final_object_keys or "")

    storage.put_bytes(key=orphan_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    auth.orphan_final_object_keys = (
        f'[{{"key":"{orphan_key}","remove_after":"{(now - timedelta(minutes=1)).isoformat()}"}}]'
    )
    session.commit()

    cleaned_after_grace = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned_after_grace == 1
    assert not storage.exists(orphan_key)
    session.refresh(auth)
    assert auth.orphan_final_object_keys is None


def test_reservation_cleanup_removes_absent_known_orphan(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    orphan_key = "performance-takes/1/absent-known/old-token.webm"
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="absent-known-orphan",
        staging_key="staging/performance-takes/1/absent-known/recording.webm",
        final_key="performance-takes/1/absent-known/current.webm",
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    auth.staging_cleanup_completed_at = now
    auth.final_cleanup_completed_at = now
    auth.orphan_final_object_keys = f'["{orphan_key}"]'
    session.add(auth)
    session.commit()

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    session.refresh(auth)
    assert auth.orphan_final_object_keys is None


def test_reservation_cleanup_preserves_remaining_orphan_remove_after(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    removable_key = "performance-takes/1/two-orphans/removable.webm"
    waiting_key = "performance-takes/1/two-orphans/waiting.webm"
    waiting_until = now + timedelta(minutes=15)
    storage.put_bytes(key=removable_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="two-orphans-preserve",
        staging_key="staging/performance-takes/1/two-orphans/recording.webm",
        final_key="performance-takes/1/two-orphans/current.webm",
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    auth.staging_cleanup_completed_at = now
    auth.final_cleanup_completed_at = now
    auth.orphan_final_object_keys = (
        "["
        f'{{"key":"{removable_key}","remove_after":"{(now - timedelta(minutes=1)).isoformat()}"}},'
        f'{{"key":"{waiting_key}","remove_after":"{waiting_until.isoformat()}"}}'
        "]"
    )
    session.add(auth)
    session.commit()

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    assert not storage.exists(removable_key)
    session.refresh(auth)
    assert removable_key not in (auth.orphan_final_object_keys or "")
    assert waiting_key in (auth.orphan_final_object_keys or "")
    assert waiting_until.isoformat() in (auth.orphan_final_object_keys or "")


def test_reservation_cleanup_does_not_remove_orphan_when_remove_after_was_extended(test_env):
    session, _storage, user_1, _ = test_env
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    orphan_key = "performance-takes/1/remove-after-extended/token.webm"
    source = _create_default_source(session, _storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="remove-after-extended",
        staging_key="staging/performance-takes/1/remove-after-extended/recording.webm",
        final_key="performance-takes/1/remove-after-extended/current.webm",
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    auth.staging_cleanup_completed_at = now
    auth.final_cleanup_completed_at = now
    extended_until = now + timedelta(minutes=20)
    auth.orphan_final_object_keys = (
        f'[{{"key":"{orphan_key}","remove_after":"{extended_until.isoformat()}"}}]'
    )
    session.add(auth)
    session.commit()

    removed = performance_take_delete_outbox_service._remove_reservation_orphan_final_keys(
        session,
        auth.id,
        (orphan_key,),
    )
    session.commit()

    assert removed is False
    session.refresh(auth)
    assert orphan_key in (auth.orphan_final_object_keys or "")
    assert extended_until.isoformat() in (auth.orphan_final_object_keys or "")


def test_reservation_cleanup_does_not_delete_orphan_key_referenced_by_take(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    referenced_key = "performance-takes/1/referenced-orphan/token.webm"
    storage.put_bytes(key=referenced_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_source(session, storage)
    auth = _expired_cleanup_auth(
        practice_source_id=source.id,
        user_id=user_1.id,
        client_request_id="referenced-orphan",
        staging_key="staging/performance-takes/1/referenced-orphan/recording.webm",
        final_key=referenced_key,
    )
    auth.status = PerformanceTakeUploadReservationStatus.COMPLETED
    auth.staging_cleanup_completed_at = now
    auth.final_cleanup_completed_at = now
    auth.orphan_final_object_keys = f'["{referenced_key}"]'
    session.add(auth)
    session.flush()
    session.add(
        PerformanceTake(
            take_uuid="take-referenced-orphan",
            user_id=user_1.id,
            practice_source_id=source.id,
            linked_score_id=10,
            score_title_snapshot="Referenced orphan",
            upload_reservation_id=auth.id,
            media_kind=PerformanceTakeMediaKind.AUDIO,
            media_mime_type="audio/webm",
            media_byte_size=len(VALID_WEBM_BYTES),
            media_object_key=referenced_key,
            storage_backend="local",
            duration_ms=1000,
            scope_type="FULL",
            scope_start_beat=0.0,
            scope_terminal_beat=4.0,
            tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
            recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
            deletion_status=PerformanceTakeDeletionStatus.ACTIVE,
        )
    )
    session.commit()

    cleaned = performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    assert storage.exists(referenced_key)
    session.refresh(auth)
    assert referenced_key in (auth.orphan_final_object_keys or "")


def test_expired_finalizing_lease_records_candidate_before_retry(test_env):
    session, storage, user_1, _ = test_env
    source = _create_default_source(session, storage)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    candidate_key = "performance-takes/1/finalizing-expired/old-token.webm"
    auth = PerformanceTakeUploadReservation(
        user_id=user_1.id,
        practice_source_id=source.id,
        client_request_id="finalizing-expired-retry",
        take_uuid="finalizing-expired",
        score_id=10,
        score_uuid="score-uuid-10",
        score_title="Finalizing retry",
        revision_id=100,
        revision_uuid=DEFAULT_TAKE_REVISION_ID,
        artifact_id=DEFAULT_TAKE_ARTIFACT_ID,
        scope_type="FULL",
        scope_start_beat=0.0,
        scope_terminal_beat=4.0,
        tempo_plan=json.dumps(DEFAULT_TAKE_TEMPO_PLAN),
        recording_timebase=json.dumps(DEFAULT_TAKE_RECORDING_TIMEBASE),
        duration_ms=1000,
        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=len(VALID_WEBM_BYTES),
        storage_backend="local",
        staging_object_key="staging/performance-takes/1/finalizing-expired/recording.webm",
        final_object_key=candidate_key,
        finalizing_object_key=candidate_key,
        storage_reservation_id="reservation-finalizing-expired",
        status=PerformanceTakeUploadReservationStatus.FINALIZING,
        expires_at=now + timedelta(minutes=10),
        last_put_url_expires_at=now + timedelta(minutes=10),
        staging_cleanup_after=now + timedelta(minutes=10),
        finalizing_token="old-token",
        finalizing_expires_at=now - timedelta(minutes=1),
    )
    session.add(auth)
    session.commit()

    performance_take_delete_outbox_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    session.refresh(auth)
    assert auth.status == PerformanceTakeUploadReservationStatus.RESERVED
    assert auth.finalizing_token is None
    assert auth.finalizing_object_key is None
    assert candidate_key in (auth.orphan_final_object_keys or "")


def test_worker_handles_already_absent_object_idempotently(
    test_env, monkeypatch: pytest.MonkeyPatch
):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
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

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "source": {"score_id": "score-uuid-10"},
            "media": {"byte_size": size, "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"start_beat": 0.0, "terminal_beat": 4.0},
            "client_request_id": "req-oss-idemp",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        auth_data = res_auth.json()["data"]
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=content,
            content_type="audio/webm",
        )

        reserved_upload_id = res_id
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200

        take_row = session.execute(
            select(PerformanceTake).where(PerformanceTake.take_uuid == take_id)
        ).scalar_one()
        final_key = take_row.media_object_key
        assert final_key.startswith(f"performance-takes/1/{take_id}/")
        assert storage.exists(final_key)

        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 202

        outbox = session.execute(
            select(PerformanceTakeDeleteOutbox).where(
                PerformanceTakeDeleteOutbox.take_uuid == take_id
            )
        ).scalar_one()

        # Simulate a final object that is already absent before the worker runs.
        # This verifies idempotent absent-object handling, not a real DB commit
        # failure after successful object deletion.
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
    return database_url.replace("postgresql+asyncpg://", "postgresql://", 1).replace(
        "postgresql+psycopg://", "postgresql://", 1
    )


def _postgres_sqlalchemy_url(database_url: str, *, driver: str) -> str:
    normalized = _normalise_psycopg_url(database_url)
    return normalized.replace("postgresql://", f"postgresql+{driver}://", 1)


def _postgres_migration_test_database(env_var: str) -> PostgresMigrationTestDatabase:
    import psycopg

    database_url = os.environ.get(env_var)
    if not database_url:
        pytest.skip(
            f"PostgreSQL migration test NOT VERIFIED: set {env_var} to an explicit "
            "dedicated PostgreSQL test database URL."
        )

    normalized = _normalise_psycopg_url(database_url.strip())
    if not normalized.startswith("postgresql://"):
        pytest.skip(f"PostgreSQL migration test NOT VERIFIED: {env_var} must use a PostgreSQL URL.")

    conn = psycopg.connect(normalized, autocommit=True, connect_timeout=3)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT current_database(), current_user, rolsuper, rolcreatedb
                FROM pg_roles
                WHERE rolname = current_user
                """
            )
            database_name, _user_name, is_superuser, can_create_db = cur.fetchone()
            if not str(database_name).startswith(POSTGRES_TEST_DATABASE_PREFIX):
                pytest.skip(
                    "PostgreSQL migration test NOT VERIFIED: target database name must "
                    f"start with {POSTGRES_TEST_DATABASE_PREFIX!r}."
                )
            if is_superuser or can_create_db:
                pytest.skip(
                    "PostgreSQL migration test NOT VERIFIED: test user must not be "
                    "SUPERUSER and must not have CREATEDB."
                )
    finally:
        conn.close()

    return PostgresMigrationTestDatabase(
        database_name=database_name,
        psycopg_url=normalized,
        sqlalchemy_sync_url=_postgres_sqlalchemy_url(normalized, driver="psycopg"),
        alembic_async_url=_postgres_sqlalchemy_url(normalized, driver="psycopg"),
    )


def _assert_postgres_database_empty(database_url: str) -> None:
    import psycopg

    conn = psycopg.connect(database_url, autocommit=True, connect_timeout=3)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                """
            )
            tables = [row[0] for row in cur.fetchall()]
            if tables:
                pytest.skip(
                    "PostgreSQL migration test NOT VERIFIED: target test database is "
                    f"not empty; rebuild the isolated test container/database. Tables: {tables}"
                )
    finally:
        conn.close()


def _alembic_config(database_url: str):
    from alembic.config import Config

    alembic_dir = str(Path(__file__).resolve().parents[1] / "alembic")
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", alembic_dir)
    cfg.set_main_option("sqlalchemy.url", database_url)
    return cfg


def _assert_performance_take_upgrade_state(
    *, alembic_async_url: str, sqlalchemy_sync_url: str
) -> None:
    from alembic import command
    import sqlalchemy as sa

    command.upgrade(
        _alembic_config(alembic_async_url),
        "0053_practice_source_takes",
    )
    engine_pg = create_engine(sqlalchemy_sync_url)
    try:
        inspector = inspect(engine_pg)
        tables = set(inspector.get_table_names())
        assert "practice_source_snapshots" in tables
        assert "performance_take_upload_authorizations" in tables
        assert "performance_take_delete_outbox" in tables
        assert "practice_source_snapshot_delete_outbox" in tables
        version_cols = {c["name"]: c for c in inspector.get_columns("alembic_version")}
        assert getattr(version_cols["version_num"]["type"], "length", None) == 128
        snapshot_cols = {c["name"]: c for c in inspector.get_columns("practice_source_snapshots")}
        assert snapshot_cols["status"]["nullable"] is False
        assert snapshot_cols["status"].get("default") is None
        assert snapshot_cols["creation_expires_at"]["nullable"] is True
        snapshot_checks = {
            check["name"] for check in inspector.get_check_constraints("practice_source_snapshots")
        }
        assert "ck_practice_source_snapshots_creation_lease" in snapshot_checks
        snapshot_indexes = {
            idx["name"] for idx in inspector.get_indexes("practice_source_snapshots")
        }
        assert "ix_practice_source_snapshots_status_creation" in snapshot_indexes

        cols = {c["name"]: c for c in inspector.get_columns("performance_takes")}
        assert cols["source_snapshot_id"]["nullable"] is False
        assert "score_id" not in cols
        assert cols["linked_score_id"]["nullable"] is True
        assert "revision_id" not in cols
        assert "artifact_id" not in cols
        assert cols["tempo_plan"]["nullable"] is False
        assert "resolved_tempo_plan" not in cols
        assert cols["recording_timebase"]["nullable"] is False
        assert "evaluation" not in cols
        assert "sync_metadata" not in cols
        assert "score_title_snapshot" in cols
        assert cols["score_title_snapshot"]["nullable"] is False
        assert "scope_type" in cols
        assert cols["scope_type"]["nullable"] is False
        assert "deletion_status" in cols
        assert cols["deletion_status"]["nullable"] is False

        share_grant_cols = {c["name"]: c for c in inspector.get_columns("score_share_grants")}
        assert "access_mode" in share_grant_cols
        assert "allow_practice" not in share_grant_cols

        publication_cols = {c["name"]: c for c in inspector.get_columns("score_publications")}
        assert "access_mode" in publication_cols
        assert "allow_practice" not in publication_cols

        auth_cols = {
            c["name"]: c for c in inspector.get_columns("performance_take_upload_authorizations")
        }
        assert auth_cols["source_snapshot_id"]["nullable"] is True
        assert auth_cols["score_title"]["nullable"] is False

        fks = inspector.get_foreign_keys("performance_takes")
        assert len([fk for fk in fks if fk["referred_table"] == "scores"]) == 1
        score_fk = next(f for f in fks if f["referred_table"] == "scores")
        assert score_fk["options"].get("ondelete") == "SET NULL"
        assert not any(fk["referred_table"] == "score_revisions" for fk in fks)
        snapshot_fk = next(f for f in fks if f["referred_table"] == "practice_source_snapshots")
        assert snapshot_fk["options"].get("ondelete") == "RESTRICT"
        user_fk = next(f for f in fks if f["referred_table"] == "users")
        assert user_fk["options"].get("ondelete") == "CASCADE"

        indexes = {idx["name"] for idx in inspector.get_indexes("performance_takes")}
        assert {
            "ix_performance_takes_take_uuid",
            "ix_performance_takes_user_id",
            "ix_performance_takes_linked_score_id",
            "ix_performance_takes_client_request_id",
            "ix_performance_takes_user_deletion_status",
            "ix_performance_takes_source_snapshot_id",
        }.issubset(indexes)
        assert "ix_performance_takes_revision_id" not in indexes

        unique_constraints = inspector.get_unique_constraints("performance_takes")
        uq_names = [
            uc["name"]
            for uc in unique_constraints
            if "uq_performance_takes_user_client_request_id" in str(uc.get("name", ""))
        ]
        assert len(uq_names) == 1, f"Expected 1 unique constraint, got: {unique_constraints}"

        with engine_pg.connect() as pconn:
            assert (
                pconn.execute(sa.text("SELECT count(*) FROM performance_takes")).scalar_one() == 0
            )
            assert (
                pconn.execute(
                    sa.text("SELECT count(*) FROM performance_take_upload_authorizations")
                ).scalar_one()
                == 0
            )
    finally:
        engine_pg.dispose()


def test_empty_postgresql_database_initializes_with_wide_alembic_version_table():
    """Run the real migration chain from a pre-provisioned empty PostgreSQL database."""

    from alembic import command

    pg = _postgres_migration_test_database(POSTGRES_MIGRATION_EMPTY_URL_ENV)
    _assert_postgres_database_empty(pg.psycopg_url)
    command.upgrade(
        _alembic_config(pg.alembic_async_url),
        "0053_practice_source_takes",
    )
    engine_pg = create_engine(pg.sqlalchemy_sync_url)
    try:
        inspector = inspect(engine_pg)
        version_cols = {c["name"]: c for c in inspector.get_columns("alembic_version")}
        assert getattr(version_cols["version_num"]["type"], "length", None) == 128
        assert "performance_takes" in inspector.get_table_names()
    finally:
        engine_pg.dispose()


def test_unpublished_practice_migration_marker_repair_updates_known_removed_revision(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    from scripts import repair_unpublished_practice_migration_state as repair

    db_url = f"sqlite:///{tmp_path / 'alembic-marker.db'}"
    engine = create_engine(db_url)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(128))"))
            conn.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:version)"),
                {"version": "0069_practice_source_snapshots"},
            )

        monkeypatch.setattr(repair.settings, "DATABASE_URL", db_url)
        repair.main()

        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == (
                "0052_practice_step_verifier_provider"
            )
    finally:
        engine.dispose()


def test_unpublished_practice_migration_marker_is_repaired_before_upgrade(
    monkeypatch: pytest.MonkeyPatch,
):
    """A dev DB left on a removed feature-branch revision can run final 0053."""

    from alembic import command
    from scripts import repair_unpublished_practice_migration_state as repair

    pg = _postgres_migration_test_database(POSTGRES_MIGRATION_EMPTY_URL_ENV)
    _assert_postgres_database_empty(pg.psycopg_url)
    command.upgrade(
        _alembic_config(pg.alembic_async_url),
        "0052_practice_step_verifier_provider",
    )

    engine_pg = create_engine(pg.sqlalchemy_sync_url)
    try:
        with engine_pg.begin() as conn:
            conn.execute(
                text("UPDATE alembic_version SET version_num = '0069_practice_source_snapshots'")
            )
            conn.execute(text("CREATE TABLE practice_sources (id BIGSERIAL PRIMARY KEY)"))

        monkeypatch.setattr(repair.settings, "DATABASE_URL", pg.alembic_async_url)
        repair.main()

        with engine_pg.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == (
                "0052_practice_step_verifier_provider"
            )
    finally:
        engine_pg.dispose()

    _assert_performance_take_upgrade_state(
        alembic_async_url=pg.alembic_async_url,
        sqlalchemy_sync_url=pg.sqlalchemy_sync_url,
    )


def test_postgresql_version_table_widening_permission_error_is_not_swallowed():
    """A permission failure while widening alembic_version must abort before migrations."""

    from alembic import command
    from sqlalchemy.exc import DBAPIError

    pg = _postgres_migration_test_database(POSTGRES_MIGRATION_RESTRICTED_ALEMBIC_URL_ENV)
    with pytest.raises((DBAPIError, PermissionError, RuntimeError)):
        command.upgrade(
            _alembic_config(pg.alembic_async_url),
            "0053_practice_source_takes",
        )


@contextmanager
def _reservation_client(session, storage, user):
    service = _performance_take_service(storage=storage)

    async def db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_performance_take_service] = lambda: service
    try:
        yield PerformanceTakeTestClient(app), service
    finally:
        app.dependency_overrides.clear()


def _upload_intent():
    return _reservation_request_payload(
        {
            "client_request_id": "immutable-video",
            "source": {"score_id": "score-uuid-10"},
            "media": {
                "kind": "VIDEO",
                "byte_size": len(VALID_WEBM_BYTES),
                "mime_type": "video/webm",
                "duration_ms": 5000,
            },
            "scope": {
                "kind": "RANGE",
                "start_beat": 0,
                "terminal_beat": 16,
                "start_group_id": "group-0",
                "end_group_id": "group-5",
            },
        }
    )


def test_reservation_identity_metadata_replay_and_structural_take_lineage(test_env):
    session, storage, user, other = test_env
    with _reservation_client(session, storage, user) as (client, _):
        request = _upload_intent()
        first = client.post("/api/v1/performance-takes/upload-reservations", json=request).json()[
            "data"
        ]
        row = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == first["reservation_id"],
            )
        ).scalar_one()
        assert first["reservation_id"] != row.storage_reservation_id
        assert first["metadata"] == {k: v for k, v in request.items() if k != "client_request_id"}
        repeated = client.post(
            "/api/v1/performance-takes/upload-reservations", json=request
        ).json()["data"]
        assert repeated["reservation_id"] == first["reservation_id"]
        assert repeated["take_id"] == first["take_id"]
        assert repeated["upload_target"] is not None
        for method, suffix in [(client.post, "/finalize"), (client.delete, "")]:
            assert (
                method(
                    f"/api/v1/performance-takes/upload-reservations/{row.storage_reservation_id}{suffix}"
                ).status_code
                == 404
            )
            app.dependency_overrides[get_current_user] = lambda: other
            assert (
                method(
                    f"/api/v1/performance-takes/upload-reservations/{first['reservation_id']}{suffix}"
                ).status_code
                == 404
            )
            app.dependency_overrides[get_current_user] = lambda: user
        url = f"/api/v1/performance-takes/upload-reservations/{first['reservation_id']}/finalize"
        assert client.post(url, json={"media": request["media"]}).status_code == 422
        storage.put_bytes(
            key=row.staging_object_key, content=VALID_WEBM_BYTES, content_type="video/webm"
        )
        finalized = client.post(url)
        assert finalized.status_code == 200, finalized.text
        data = finalized.json()["data"]
        assert data["media_kind"] == "VIDEO"
        assert data["scope_start_group_id"] == request["scope"]["start_group_id"]
        assert data["scope_end_group_id"] == request["scope"]["end_group_id"]
        assert data["tempo_plan"] == request["tempo_plan"]
        assert data["recording_timebase"] == request["recording_timebase"]
        take = session.execute(
            select(PerformanceTake).where(PerformanceTake.upload_reservation_id == row.id)
        ).scalar_one()
        assert take.take_uuid == first["take_id"]
        assert client.post(url).json()["data"] == data
        completed = client.post(
            "/api/v1/performance-takes/upload-reservations", json=request
        ).json()["data"]
        assert completed["reservation_id"] == first["reservation_id"]
        assert completed["status"] == "COMPLETED" and completed["upload_target"] is None
        assert completed["take"] == data


@pytest.mark.parametrize(
    "part, field, changed",
    [
        ("source", "revision_id", "another-revision"),
        ("source", "artifact_id", "another-artifact"),
        ("media", "byte_size", len(VALID_WEBM_BYTES) + 1),
        ("scope", "end_group_id", "another-group"),
        ("tempo_plan", "selection", {"mode": "SCORE"}),
        (
            "recording_timebase",
            "activeSegments",
            [{"perfStartMs": 1, "perfEndMs": 5001, "mediaStartMs": 0, "mediaEndMs": 5000}],
        ),
    ],
)
def test_reservation_client_request_metadata_conflicts_only_at_reserve(
    test_env, part, field, changed
):
    session, storage, user, _ = test_env
    with _reservation_client(session, storage, user) as (client, service):
        request = _upload_intent()
        assert (
            client.post("/api/v1/performance-takes/upload-reservations", json=request).status_code
            == 200
        )
        request[part] = {**request[part], field: changed}
        response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        assert response.status_code == 422
        with pytest.raises(ValidationException) as failure:
            _run_async(
                service.reserve_upload(
                    AsyncSessionAdapter(session),
                    user.id,
                    PerformanceTakeUploadReservationRequest.model_validate(request),
                )
            )
        assert failure.value.details["reason"] == "client_request_id_reuse_conflict"


@pytest.mark.parametrize("committed", [False, True])
def test_finalize_unknown_commit_outcome_recovers_via_reservation_lineage(
    test_env, monkeypatch, committed
):
    from contextlib import asynccontextmanager
    import app.modules.performance_takes.service as service_module

    session, storage, user, _ = test_env
    with _reservation_client(session, storage, user) as (client, _):
        request = _upload_intent()
        reservation = client.post(
            "/api/v1/performance-takes/upload-reservations", json=request
        ).json()["data"]
        storage.put_bytes(
            key=_staging_key(session, reservation["reservation_id"]),
            content=VALID_WEBM_BYTES,
            content_type="video/webm",
        )
        original_commit = AsyncSessionAdapter.commit
        pending = True

        async def disconnect_once(adapter):
            nonlocal pending
            completing = any(
                isinstance(row, PerformanceTakeUploadReservation) and row.status == "COMPLETED"
                for row in session.identity_map.values()
            )
            if pending and completing:
                pending = False
                if committed:
                    await original_commit(adapter)
                raise DBAPIError.instance(
                    "COMMIT",
                    {},
                    Exception("connection is closed"),
                    Exception,
                    connection_invalidated=True,
                )
            await original_commit(adapter)

        @asynccontextmanager
        async def recovery_session():
            yield AsyncSessionAdapter(session)

        monkeypatch.setattr(AsyncSessionAdapter, "commit", disconnect_once)
        monkeypatch.setattr(service_module, "AsyncSessionLocal", recovery_session)
        url = f"/api/v1/performance-takes/upload-reservations/{reservation['reservation_id']}/finalize"
        response = client.post(url)
        assert response.status_code == 503, response.text
        assert pending is False
        row = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == reservation["reservation_id"]
            )
        ).scalar_one()
        assert row.status == ("COMPLETED" if committed else "RESERVED")
        if not committed:
            assert row.orphan_final_object_keys is not None
        retry = client.post(url)
        assert retry.status_code == 200, retry.text
        assert retry.json()["data"]["take_id"] == reservation["take_id"]
        account = session.get(StorageUsageAccount, user.id)
        session.refresh(account)
        assert account.reserved_bytes == 0 and account.used_bytes == len(VALID_WEBM_BYTES)
        assert len(session.execute(select(PerformanceTake)).scalars().all()) == 1


def test_live_and_saved_consumers_share_verified_durable_source(test_env):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock
    from app.modules.practice.source.router import get_practice_source_service
    from app.modules.practice.source.builder import PracticeSourceBuilder

    session, storage, user, _ = test_env
    canonical = (Path(__file__).parent / "fixtures/musicxml/canonical-practice-score.musicxml").read_bytes()
    storage.put_bytes(key="canonical.musicxml", content=canonical, content_type="application/xml")
    assets = Mock()
    assets.canonical_source = AsyncMock(return_value=SimpleNamespace(storage_key="canonical.musicxml"))
    source_service = PracticeSourceService(storage=storage, asset_repository=assets)
    take_service = PerformanceTakeService(storage=storage, practice_source_service=source_service)

    async def override_db():
        yield AsyncSessionAdapter(session)

    app.dependency_overrides.update({
        get_db: override_db,
        get_current_user: lambda: user,
        get_practice_source_service: lambda: source_service,
        get_performance_take_service: lambda: take_service,
    })
    client = PerformanceTakeTestClient(app)
    live_url = "/api/v1/practice/scores/score-uuid-10/revisions/revision-uuid-100/source"
    try:
        with patch.object(source_service.builder, "build", wraps=source_service.builder.build) as build:
            artifact_only = client.get(live_url)
            assert artifact_only.status_code == 200, artifact_only.text
            build.assert_called_once()
        payload = artifact_only.json()["data"]
        assert payload["notation"] is None
        row = session.execute(select(PracticeSourceRecord)).scalar_one()
        assert row.status == "READY"
        assert row.live_revision_id == 100
        assert row.source_id == payload["source_id"]
        expected = PracticeSourceBuilder().build(score_id="score-uuid-10", revision_id="revision-uuid-100", canonical_musicxml=canonical)
        assert row.source_id == expected.source_id
        assert row.prepared_musicxml_object_key == f"practice-sources/{row.source_id}/score.musicxml"
        assert row.artifact_object_key == f"practice-sources/{row.source_id}/artifact.json"
        assert storage.read_bytes(row.prepared_musicxml_object_key) == expected.prepared_musicxml.data
        assert storage.read_bytes(row.artifact_object_key) == expected.artifact.representation.data
        assert row.prepared_musicxml_sha256 == expected.prepared_musicxml.sha256
        assert row.artifact_sha256 == expected.artifact.representation.sha256
        assert row.prepared_musicxml_byte_size == expected.prepared_musicxml.byte_size
        assert row.artifact_byte_size == expected.artifact.representation.byte_size
        assert practice_source_delete_service.recover_unowned_ready(session, storage_backend=storage.backend_name) == []
        assert practice_source_delete_service.enqueue_if_unowned(session, row.id, storage_backend=storage.backend_name) is None
        with patch.object(storage, "put_bytes", wraps=storage.put_bytes) as writes:
            with_notation = client.get(live_url + "?include_notation=true")
            again = client.get(live_url)
            assert with_notation.status_code == again.status_code == 200
            writes.assert_not_called()
        assert with_notation.json()["data"]["source_id"] == payload["source_id"]
        assert with_notation.json()["data"]["notation"]["musicxml"] == expected.prepared_musicxml.content
        assert len(session.execute(select(PracticeSourceRecord)).scalars().all()) == 1
        reserved = client.post("/api/v1/performance-takes/upload-reservations", json={
            "source": {"score_id": "score-uuid-10", "revision_id": "revision-uuid-100", "artifact_id": row.artifact_id},
            "media": {"byte_size": len(VALID_WEBM_BYTES), "mime_type": "audio/webm", "duration_ms": 5000},
            "scope": {"kind": "FULL", "start_beat": 0, "terminal_beat": 4},
            "client_request_id": "durable-source-reservation",
        })
        assert reserved.status_code == 200, reserved.text
        reservation = session.execute(select(PerformanceTakeUploadReservation)).scalar_one()
        assert reservation.practice_source_id == row.id
        assert len(session.execute(select(PracticeSourceRecord)).scalars().all()) == 1
        take = _create_default_take(session, user_id=user.id, practice_source_id=row.id,
            client_request_id="saved-source", take_uuid="saved-source-take", media_object_key="take.webm")
        session.commit()
        with patch.object(source_service.builder, "build", wraps=source_service.builder.build) as build:
            saved = client.get(f"/api/v1/performance-takes/{take.take_uuid}/practice-source?include_notation=true")
            build.assert_not_called()
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"] == with_notation.json()["data"]
        storage.put_bytes(key=row.artifact_object_key, content=b"corrupt", content_type="application/json")
        with patch.object(storage, "put_bytes", wraps=storage.put_bytes) as writes:
            corrupt = client.get(live_url)
            assert corrupt.status_code >= 400
            writes.assert_not_called()
        assert storage.read_bytes(row.artifact_object_key) == b"corrupt"
    finally:
        app.dependency_overrides.clear()


def test_live_revision_deletion_is_discovered_by_bounded_source_scan(test_env, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FILE_STORAGE_BACKEND", "local")
    session, storage, _, _ = test_env
    source = _create_default_source(session, storage)
    source.live_revision_id = 100
    session.commit()
    assert practice_source_delete_service.recover_unowned_ready(session, storage_backend=storage.backend_name) == []
    score = session.get(Score, 10)
    score.head_revision_id = None
    session.flush()
    session.delete(session.get(ScoreRevision, 100))
    session.commit()
    session.refresh(source)
    assert source.live_revision_id is None
    assert source.source_revision_uuid == DEFAULT_TAKE_REVISION_ID
    with patch.object(practice_source_delete_service, "enqueue_if_unowned", wraps=practice_source_delete_service.enqueue_if_unowned) as enqueue:
        due = practice_source_delete_service.recover_and_list_due(session)
        assert enqueue.call_count == 1
    session.commit()
    assert len(due) == 1
    result = _run_source_deletion(monkeypatch, session, storage, due[0])
    assert result["status"] == "deleted"
    assert session.get(PracticeSourceRecord, source.id) is None


@pytest.mark.parametrize("terminal", ["CANCELLED", "EXPIRED", "COMPLETED"])
def test_terminal_reservation_does_not_retain_orphan_source(test_env, monkeypatch, terminal):
    from app.core.config import settings
    monkeypatch.setattr(settings, "FILE_STORAGE_BACKEND", "local")
    session, storage, user, _ = test_env
    source = _create_default_source(session, storage)
    take = _create_default_take(session, user_id=user.id, practice_source_id=source.id,
        client_request_id="terminal-source", take_uuid="terminal-source-take", media_object_key="terminal.webm")
    reservation = session.get(PerformanceTakeUploadReservation, take.upload_reservation_id)
    reservation.practice_source_id = source.id
    reservation.status = terminal
    session.delete(take)
    session.commit()
    due = practice_source_delete_service.recover_and_list_due(session)
    session.commit()
    assert len(due) == 1
    assert _run_source_deletion(monkeypatch, session, storage, due[0])["status"] == "deleted"
    session.refresh(reservation)
    assert reservation.practice_source_id is None


def test_source_orphan_scan_has_a_bounded_batch(test_env, monkeypatch):
    from app.core.config import settings
    session, storage, _, _ = test_env
    for index in range(3):
        _create_default_source(session, storage, source_revision_uuid=f"orphan-{index}")
    session.commit()
    monkeypatch.setattr(settings, "PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE", 2)
    assert len(practice_source_delete_service.recover_unowned_ready(session, storage_backend=storage.backend_name)) == 2
    assert len(session.execute(select(PracticeSourceRecord).where(PracticeSourceRecord.status == "READY")).scalars().all()) == 1


@pytest.mark.parametrize("failure_point", ["WRITE", "READ_BACK"])
def test_incomplete_creation_releases_live_link_for_durable_cleanup(test_env, monkeypatch, failure_point):
    session, storage, _, _ = test_env
    source = _canonical_source("score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID)
    repository = PracticeSourceRepository(storage)
    original_put = storage.put_bytes
    original_read = storage.read_bytes

    def put(**kwargs):
        if failure_point == "WRITE" and kwargs["key"].endswith("artifact.json"):
            raise ConnectionError("Source object write unavailable")
        return original_put(**kwargs)

    def read(key):
        value = original_read(key)
        return b"invalid read-back" if failure_point == "READ_BACK" else value

    with patch.object(storage, "put_bytes", side_effect=put), patch.object(storage, "read_bytes", side_effect=read):
        with pytest.raises(ValidationException) as caught:
            _run_async(repository.get_or_create(AsyncSessionAdapter(session), source, live_revision_id=100))
    assert caught.value.details["reason"] == "practice_source_storage_write_failed"
    row = session.execute(select(PracticeSourceRecord)).scalar_one()
    assert row.status == "DELETING"
    assert row.live_revision_id is None
    assert session.get(ScoreRevision, 100) is not None
    outbox = session.execute(select(PracticeSourceDeleteOutbox)).scalar_one()
    assert _run_source_deletion(monkeypatch, session, storage, outbox.outbox_uuid)["status"] == "deleted"


@pytest.mark.parametrize("status", ["RESERVED", "FINALIZING"])
def test_active_reservation_retains_source_after_revision_deletion(test_env, status):
    session, storage, user, _ = test_env
    source = _create_default_source(session, storage)
    source.live_revision_id = 100
    take = _create_default_take(session, user_id=user.id, practice_source_id=source.id,
        client_request_id="active-source", take_uuid="active-source-take", media_object_key="active.webm")
    reservation = session.get(PerformanceTakeUploadReservation, take.upload_reservation_id)
    reservation.practice_source_id = source.id
    reservation.status = status
    session.delete(take)
    score = session.get(Score, 10)
    score.head_revision_id = None
    session.flush()
    session.delete(session.get(ScoreRevision, 100))
    session.commit()
    session.refresh(source)
    assert source.live_revision_id is None
    assert practice_source_delete_service.recover_unowned_ready(session, storage_backend=storage.backend_name) == []
    assert source.status == "READY"


def test_source_deletion_dispatch_publishes_registered_durable_operation(test_env, monkeypatch):
    from app.worker.dispatch import practice_source_deletion as dispatch
    session, storage, _, _ = test_env
    source = _create_default_source(session, storage)
    outbox = practice_source_delete_service.enqueue_if_unowned(session, source.id, storage_backend=storage.backend_name)
    session.commit()
    monkeypatch.setattr(dispatch, "get_worker_db", lambda: _mock_worker_db(session))
    with patch.object(dispatch, "send_durable_task", return_value=True) as send:
        assert dispatch.dispatch_practice_source_deletion(outbox.outbox_uuid)
    assert send.call_args.kwargs["task_name"] == "app.worker.tasks.practice_source_deletion_task"
    assert send.call_args.kwargs["operation_kind"] == "practice_source_deletion"
    assert send.call_args.kwargs["task_kwargs"] == {"outbox_uuid": outbox.outbox_uuid}
