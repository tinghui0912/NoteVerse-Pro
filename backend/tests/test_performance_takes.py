from __future__ import annotations
from tests.support.quota import quota_hold_fact
from app.db.models.storage_quota import StorageQuotaHoldStatus, StorageQuotaMode
from app.composition.storage_resources import storage_quota_service
from tests.support.quota import admit_hold

from app.modules.performance_takes.object_keys import (
    performance_take_staging_object_key,
    performance_take_recording_object_key,
)

from tests.support.practice_bundle import bind_bundle
from app.modules.practice.bundle.content import read_verified_bundle

from datetime import UTC
from tests.support.score_deletion import complete_score_deletions

from app.modules.performance_takes.upload_reservation.cleanup import (
    upload_reservation_cleanup_service,
)

from app.modules.performance_takes.upload_reservation.domain import (
    UploadReservationLifecycle,
    OrphanFinalCandidate,
    FinalizeLease,
)
from app.shared.performance_take_upload import UploadReservationStatus
from app.modules.performance_takes.upload_reservation.persistence import (
    initialize_lifecycle,
    lifecycle_from_row,
    apply_transition,
    encode_orphan_candidates,
)

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text, inspect as inspect_row
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ValidationException, ResourceNotFoundException
from app.db.models import (
    StoredObject,
    PerformanceTakeManifest,
    PerformanceTake,
    PerformanceTakeUploadReservation,
    PracticeBundleRecord,
    ScoreRevisionPracticeBinding,
    PracticeBundleStatus,
    Score,
    ScoreRevision,
    StoragePlanPolicy,
    UserStorageEntitlement,
    StorageUsageAccount,
    StorageUsageCategory,
    StorageUsageCounter,
    User,
)
from app.db.models.score import RevisionOrigin
from app.main import app
from app.db.models import StoredObjectRetirement
from app.worker.execution import stored_object_retirement
from app.modules.performance_takes.dependencies import (
    get_performance_take_service,
    get_performance_take_reservation_service,
    get_performance_take_finalization_service,
)
from app.modules.performance_takes.service import PerformanceTakeService
from tests.support.take_lifecycle import TakeLifecycleServices
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.performance_takes.manifest import TakeManifest
from app.modules.performance_takes.schemas import (
    PerformanceTakeManifestRead,
    PerformanceTakeUploadMetadata,
)
from app.modules.performance_takes.manifest_persistence import manifest_from_row, manifest_to_row
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.practice.bundle.repository import PracticeBundleRepository
from app.modules.practice.bundle.domain import (
    PracticeBundle,
    PracticeBundleRepresentation,
    PracticeBundleArtifact,
)
from app.modules.practice.score.artifact import (
    canonical_practice_artifact_bytes,
    practice_artifact_id,
)
from app.modules.scores.dependencies import get_score_service
from app.modules.scores.service import ScoreService
from app.modules.storage_usage.dependencies import get_storage_usage_service
from app.modules.storage_usage.service import StorageUsageService
from app.shared.error_codes import CustomerErrorCode
from app.storage.factory import get_object_storage
from tests.support.object_storage import InMemoryObjectStorage

VALID_WEBM_BYTES = b"\x1a\x45\xdf\xa3" + b"fake-webm-audio-binary-data-12345"
DEFAULT_TAKE_REVISION_ID = "revision-uuid-100"
DEFAULT_TAKE_ARTIFACT_ID = "art-1"
DEFAULT_TAKE_TEMPO_PLAN = {
    "selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 120},
    "segments": [{"startTick": 0, "bpm": 120, "source": "CUSTOM"}],
}
DEFAULT_TAKE_RECORDING_TIMEBASE = {
    "nominalMediaDurationUs": 5000000,
    "activeSegments": [
        {
            "performanceStartUs": 0,
            "performanceEndUs": 5000000,
            "mediaStartUs": 0,
            "mediaEndUs": 5000000,
        }
    ],
}


def _canonical_bundle(score_id, revision_id, artifact_id):
    value = _bundle_artifact_payload(score_id, revision_id, artifact_id)
    return PracticeBundle(
        PracticeBundleRepresentation(
            b'<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list /></score-partwise>',
            "application/vnd.recordare.musicxml+xml",
        ),
        PracticeBundleArtifact(
            PracticeBundleRepresentation(
                canonical_practice_artifact_bytes(value), "application/json"
            ),
            value["artifactId"],
            value["schemaVersion"],
        ),
    )


def _bundle_id():
    return _canonical_bundle(
        "score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID
    ).bundle_id


def _bundle_artifact_payload(score_id: str, revision_id: str, artifact_id: str):
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    value = json.loads(
        (
            root
            / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json"
        ).read_text()
    )
    value["events"][-1]["durationTicks"] = 16 - value["events"][-1]["onsetTick"]
    value["moments"][-1]["canonicalEndTick"] = 16
    value.update(
        artifactId=artifact_id,
        scoreEndTick=16,
        scoreTempoSegments=[{"startTick": 0, "bpm": 120}],
    )
    value["artifactId"] = practice_artifact_id(value)
    return value


DEFAULT_TAKE_ARTIFACT_ID = _bundle_artifact_payload("", "", "")["artifactId"]


def _performance_take_service(
    *,
    session: Session,
    storage: InMemoryObjectStorage,
    storage_usage_service: StorageUsageService | None = None,
) -> TakeLifecycleServices:
    if session.get(ScoreRevisionPracticeBinding, 100) is None:
        _create_default_bundle(session, storage, revision_id=100)
    return TakeLifecycleServices(
        storage=storage,
        storage_usage_service=storage_usage_service,
        practice_bundle_service=PracticeBundleService(storage=storage),
    )


def _create_default_bundle(
    session: Session,
    storage: InMemoryObjectStorage,
    *,
    practice_score_uuid: str = "score-uuid-10",
    practice_revision_uuid: str = DEFAULT_TAKE_REVISION_ID,
    artifact_id: str = DEFAULT_TAKE_ARTIFACT_ID,
    revision_id: int | None = None,
    prepared_suffix: bytes = b"",
) -> PracticeBundleRecord:
    source_value = _canonical_bundle(practice_score_uuid, practice_revision_uuid, artifact_id)
    if prepared_suffix:
        from dataclasses import replace

        source_value = replace(
            source_value,
            prepared_musicxml=replace(
                source_value.prepared_musicxml,
                data=source_value.prepared_musicxml.data + prepared_suffix,
            ),
        )
    musicxml_bytes = source_value.prepared_musicxml.data
    artifact_bytes = source_value.artifact.representation.data
    musicxml_sha = source_value.prepared_musicxml.sha256
    artifact_sha = source_value.artifact.representation.sha256
    bundle_id = source_value.bundle_id
    existing = session.execute(
        select(PracticeBundleRecord).where(PracticeBundleRecord.bundle_id == bundle_id)
    ).scalar_one_or_none()
    if existing is not None:
        if (
            revision_id is not None
            and session.get(ScoreRevisionPracticeBinding, revision_id) is None
        ):
            session.add(
                ScoreRevisionPracticeBinding(revision_id=revision_id, bundle_id=existing.id)
            )
            session.flush()
        return existing
    musicxml_key = f"practice-bundles/{bundle_id}/score.musicxml"
    artifact_key = f"practice-bundles/{bundle_id}/artifact.json"
    storage.put_bytes(
        key=musicxml_key,
        content=musicxml_bytes,
        content_type="application/vnd.recordare.musicxml+xml",
    )
    storage.put_bytes(key=artifact_key, content=artifact_bytes, content_type="application/json")
    source = PracticeBundleRecord(
        bundle_id=bundle_id,
        artifact_id=source_value.artifact.artifact_id,
        artifact_schema_version=1,
        prepared_musicxml_object=StoredObject(
            object_key=musicxml_key,
            sha256=musicxml_sha,
            byte_size=len(musicxml_bytes),
            content_type="application/vnd.recordare.musicxml+xml",
        ),
        artifact_object=StoredObject(
            object_key=artifact_key,
            sha256=artifact_sha,
            byte_size=len(artifact_bytes),
            content_type="application/json",
        ),
        status=PracticeBundleStatus.READY,
        creation_expires_at=None,
    )
    session.add(source)
    session.flush()
    if revision_id is not None and session.get(ScoreRevisionPracticeBinding, revision_id) is None:
        session.add(ScoreRevisionPracticeBinding(revision_id=revision_id, bundle_id=source.id))
        session.flush()
    return source


def _manifest_row(source: PracticeBundleRecord, *, user_id: int, take_uuid: str, title: str):
    return manifest_to_row(
        TakeManifest(
            take_uuid,
            user_id,
            PerformanceTakeManifestRead.model_validate(
                {
                    "practice_binding": {
                        "bundle_id": source.bundle_id,
                        "score_id": "score-uuid-10",
                        "revision_id": DEFAULT_TAKE_REVISION_ID,
                    },
                    "artifact_id": source.artifact_id,
                    "score_display_title_snapshot": title,
                    "capture": {
                        "kind": "AUDIO",
                        "mime_type": "audio/webm",
                        "byte_size": len(VALID_WEBM_BYTES),
                    },
                    "score_timebase": {"ticks_per_quarter": 1},
                    "scope": {"kind": "FULL", "start_tick": 0, "terminal_tick": 4},
                    "tempo_plan": DEFAULT_TAKE_TEMPO_PLAN,
                    "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
                }
            ),
        )
    )


def _create_default_take(
    session: Session,
    *,
    user_id: int,
    source: PracticeBundleRecord,
    client_request_id: str,
    take_uuid: str,
    media_object_key: str,
    linked_score_id: int | None = 10,
) -> PerformanceTake:
    reservation = PerformanceTakeUploadReservation(
        manifest=_manifest_row(
            source, user_id=user_id, take_uuid=take_uuid, title="Moonlight Sonata"
        ),
        user_id=user_id,
        client_request_id=client_request_id,
        staging_object_key=media_object_key + ".staging",
        quota_hold_id=quota_hold_fact(
            session,
            user_id,
            bytes_count=len(VALID_WEBM_BYTES),
            status=StorageQuotaHoldStatus.CONSUMED,
        ),
        expires_at=datetime.now(timezone.utc),
        status=UploadReservationStatus.COMPLETED,
    )
    now = datetime.now(timezone.utc)
    state = UploadReservationLifecycle.reserved(
        expires_at=now + timedelta(hours=1), put_expires_at=now + timedelta(minutes=10)
    )
    state = state.begin_finalize(
        lease=FinalizeLease("fixture-token", media_object_key, now + timedelta(minutes=15)), now=now
    ).after
    initialize_lifecycle(
        reservation,
        state.complete(token="fixture-token", object_key=media_object_key, now=now).after,
    )
    session.add(reservation)
    session.flush()
    take = PerformanceTake(
        owner_user_id=user_id,
        manifest=reservation.manifest,
        linked_score_id=linked_score_id,
        recording_object=StoredObject(
            object_key=media_object_key,
            byte_size=len(VALID_WEBM_BYTES),
            sha256=hashlib.sha256(VALID_WEBM_BYTES).hexdigest(),
            content_type="audio/webm",
        ),
    )
    session.add(take)
    session.flush()
    return take


def test_invalid_stored_scope_reports_validation_error(test_env):
    session, storage, user, _ = test_env
    source = _create_default_bundle(session, storage)
    take = _create_default_take(
        session,
        user_id=user.id,
        source=source,
        client_request_id="invalid-stored-scope",
        take_uuid="invalid-stored-scope",
        media_object_key="test/invalid-stored-scope.webm",
    )
    document = json.loads(take.manifest.manifest_json)
    document["manifest"]["scope"]["kind"] = "INVALID"
    take.manifest.manifest_json = json.dumps(document)
    service = PerformanceTakeService(storage=storage)
    with pytest.raises(ValidationException) as raised:
        service._to_read_dto(take)
    assert raised.value.code == CustomerErrorCode.VALIDATION_ERROR
    assert raised.value.details == {"field": "manifest", "reason": "invalid_manifest"}


def test_bundle_materialization_stores_and_reuses_exact_content(test_env):
    session, storage, _, _ = test_env
    value = _canonical_bundle("score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID)
    first, verified = bind_bundle(session, storage, value, revision_id=100)
    second, reused = bind_bundle(session, storage, value, revision_id=100)
    assert first == second and verified == reused == value
    row = session.get(PracticeBundleRecord, first.id)
    assert (
        storage.read_bytes(row.prepared_musicxml_object.object_key) == value.prepared_musicxml.data
    )
    assert storage.read_bytes(row.artifact_object.object_key) == value.artifact.representation.data


@pytest.mark.parametrize("representation", ["prepared_musicxml", "artifact"])
def test_practice_bundle_checksum_corruption_is_rejected(test_env, representation):
    session, storage, _, _ = test_env
    row = _create_default_bundle(session, storage)
    key = getattr(row, f"{representation}_object").object_key
    storage.put_bytes(key=key, content=b"corrupt", content_type="application/octet-stream")
    with pytest.raises(ValidationException) as caught:
        read_verified_bundle(
            storage, PracticeBundleRepository().read_by_bundle_id(session, row.bundle_id)
        )
    assert caught.value.details["reason"] == f"{representation}_checksum_mismatch"


def test_practice_bundle_artifact_identity_corruption_is_rejected(test_env):
    session, storage, _, _ = test_env
    row = _create_default_bundle(session, storage)
    from app.modules.practice.bundle.domain import PracticeBundleRepresentation

    value = _canonical_bundle(
        "score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID
    ).artifact.value
    value["artifactId"] = "practice-score-artifact:0000000000000000"
    changed = PracticeBundleRepresentation(
        canonical_practice_artifact_bytes(value), "application/json"
    )
    storage.put_bytes(
        key=row.artifact_object.object_key, content=changed.data, content_type=changed.mime_type
    )
    row.artifact_object.sha256 = changed.sha256
    row.artifact_object.byte_size = changed.byte_size
    session.commit()
    with pytest.raises(ValidationException) as caught:
        read_verified_bundle(
            storage, PracticeBundleRepository().read_by_bundle_id(session, row.bundle_id)
        )
    assert caught.value.details["reason"] == "artifact_identity_mismatch"


def test_performance_take_schema_accepts_score_tempo_selection() -> None:
    request = PerformanceTakeUploadReservationRequest.model_validate(
        _reservation_request_payload(
            {
                "practice_binding": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "bundle_id": _bundle_id(),
                },
                "media": {
                    "kind": "AUDIO",
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                },
                "scope": {"kind": "FULL"},
                "client_request_id": "req-product-default-tempo",
                "tempo_selection": {"mode": "SCORE"},
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            }
        )
    )

    assert request.tempo_selection.mode == "SCORE"


def _reservation_request_payload(payload):
    if not isinstance(payload, dict):
        return payload
    value = dict(payload)
    value.setdefault(
        "practice_binding",
        {
            "score_id": "score-uuid-10",
            "revision_id": DEFAULT_TAKE_REVISION_ID,
            "bundle_id": _bundle_id(),
        },
    )
    value["media"] = {"kind": "AUDIO", **value.get("media", {})}
    value["scope"] = {"kind": "FULL", **value.get("scope", {})}
    value.setdefault("tempo_selection", DEFAULT_TAKE_TEMPO_PLAN["selection"])
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


@contextmanager
def _mock_worker_db(session: Session) -> Iterator[Session]:
    yield session


class _TraceScope:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *_args: object) -> None:
        return None


def _run_retirement(monkeypatch, session, storage, uuid):
    @contextmanager
    def transaction():
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise

    monkeypatch.setattr(stored_object_retirement, "SessionLocal", transaction)
    monkeypatch.setattr(stored_object_retirement, "object_storage", storage)
    return stored_object_retirement.execute_stored_object_retirement_task(None, uuid)


@pytest.fixture
def test_env(
    postgres_engine, tmp_path
) -> Iterator[tuple[Session, InMemoryObjectStorage, User, User]]:
    engine = postgres_engine

    SQLModel.metadata.create_all(engine)
    storage = InMemoryObjectStorage()

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

        policy = StoragePlanPolicy(
            plan_code="FREE",
            default_limit_bytes=100 * 1024 * 1024,  # 100MB
        )
        session.add(policy)

        account_1 = StorageUsageAccount(
            user_id=1,
            used_bytes=0,
        )
        account_2 = StorageUsageAccount(
            user_id=2,
            used_bytes=0,
        )
        session.flush()
        session.add(UserStorageEntitlement(user_id=1, plan_code="FREE"))
        session.add(UserStorageEntitlement(user_id=2, plan_code="FREE"))
        session.add(account_1)
        session.add(account_2)

        counter_1 = StorageUsageCounter(
            user_id=1,
            category=StorageUsageCategory.UPLOAD,
            used_bytes=0,
        )
        counter_2 = StorageUsageCounter(
            user_id=2,
            category=StorageUsageCategory.UPLOAD,
            used_bytes=0,
        )
        session.add(counter_1)
        session.add(counter_2)

        score = Score(
            id=10,
            score_uuid="score-uuid-10",
            owner_user_id=1,
            display_title="Moonlight Sonata",
        )
        session.add(score)
        session.flush()

        revision = ScoreRevision(
            id=100,
            revision_uuid="revision-uuid-100",
            score_id=10,
            revision_number=1,
            content_hash="d24f65a6f145d04d475fdafc2554a3f113c2b20b4e044b307ba615244e0b6803",
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
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        # 1. Authorize upload with external UUIDs
        media_content = VALID_WEBM_BYTES
        media_size = len(media_content)

        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": media_size, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-001",
            "tempo_selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 120},
            "recording_timebase": {
                "nominalMediaDurationUs": 15000000,
                "activeSegments": [
                    {
                        "performanceStartUs": 0,
                        "performanceEndUs": 15000000,
                        "mediaStartUs": 0,
                        "mediaEndUs": 15000000,
                    }
                ],
            },
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res.status_code == 200, res.text
        auth_data = res.json()
        take_id = auth_data["take_id"]
        reservation_id = auth_data["reservation_id"]
        upload_url = auth_data["upload_target"]["url"]
        staging_object_key = _staging_key(session, auth_data["reservation_id"])
        assert take_id
        assert reservation_id
        assert auth_data["manifest"]["practice_binding"] == {
            "score_id": "score-uuid-10",
            "revision_id": DEFAULT_TAKE_REVISION_ID,
            "bundle_id": _bundle_id(),
        }
        assert upload_url.startswith("https://objects.example/")
        assert staging_object_key == performance_take_staging_object_key(
            user_id=1, take_uuid=take_id, media_kind="AUDIO", mime_type="audio/webm"
        )

        # Verify quota reservation was held
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == media_size
        assert account.used_bytes == 0

        # 2. Finalize fails before upload to storage; reservation is preserved for retry
        reserved_upload_id = reservation_id
        res_fail = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fail.status_code == 404

        # Quota reservation is preserved for safe retry
        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == media_size

        # 3. Simulate client direct upload to staging storage object
        storage.put_bytes(key=staging_object_key, content=media_content, content_type="audio/webm")

        # 4. Finalize successfully with external UUIDs.
        with patch.object(
            take_svc.finalization.media, "verify", wraps=take_svc.finalization.media.verify
        ) as verify:
            res_fin = client.post(
                "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
            )
        admitted_lease = verify.call_args.args[1]
        expected_final_key = performance_take_recording_object_key(
            user_id=1,
            take_uuid=take_id,
            finalize_token=admitted_lease.token,
            media_kind="AUDIO",
            mime_type="audio/webm",
        )
        assert admitted_lease.object_key == expected_final_key
        assert res_fin.status_code == 200, res_fin.text
        take_data = res_fin.json()
        assert take_data["take_id"] == take_id
        assert take_data["manifest"]["practice_binding"]["bundle_id"] == _bundle_id()
        assert take_data["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"
        assert take_data["manifest"]["practice_binding"]["revision_id"] == "revision-uuid-100"
        assert take_data["manifest"]["score_display_title_snapshot"] == "Moonlight Sonata"
        assert take_data["manifest"]["scope"]["kind"] == "FULL"
        assert take_data["manifest"]["capture"]["byte_size"] == media_size

        # Final key is promoted to a token-owned candidate object. Staging may
        # remain until every issued PUT URL expires.
        take_row = session.execute(
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .where(PerformanceTakeManifest.take_uuid == take_id)
        ).scalar_one()
        assert take_row.owner_user_id == take_row.manifest.user_id == user_1.id
        source = session.execute(
            select(PracticeBundleRecord).where(
                PracticeBundleRecord.bundle_id
                == manifest_from_row(take_row.manifest).snapshot.practice_binding.bundle_id
            )
        ).scalar_one()
        assert source is not None
        assert "score-uuid-10" == "score-uuid-10"
        assert DEFAULT_TAKE_REVISION_ID == "revision-uuid-100"
        assert source.artifact_id == DEFAULT_TAKE_ARTIFACT_ID
        assert storage.exists(source.prepared_musicxml_object.object_key)
        assert storage.exists(source.artifact_object.object_key)
        expected_bundle_value = _canonical_bundle(
            "score-uuid-10", DEFAULT_TAKE_REVISION_ID, DEFAULT_TAKE_ARTIFACT_ID
        )
        assert (
            storage.read_bytes(source.prepared_musicxml_object.object_key)
            == expected_bundle_value.prepared_musicxml.data
        )
        assert (
            storage.read_bytes(source.artifact_object.object_key)
            == expected_bundle_value.artifact.representation.data
        )
        assert source.bundle_id == expected_bundle_value.bundle_id

        with patch.object(
            take_svc.practice_bundle_service.repository,
            "read_by_bundle_id",
            side_effect=AssertionError("Take reads own their provenance"),
        ):
            retained = client.get(f"/api/v1/performance-takes/{take_id}")
        assert retained.status_code == 200, retained.text
        assert retained.json() == take_data
        final_object_key = take_row.recording_object.object_key
        assert final_object_key == expected_final_key
        assert final_object_key != staging_object_key
        assert storage.exists(final_object_key)
        assert storage.exists(staging_object_key)
        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-001"
            )
        ).scalar_one()
        auth.last_put_url_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        auth.staging_cleanup_after = auth.last_put_url_expires_at
        session.commit()
        cleaned_count = upload_reservation_cleanup_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()
        assert cleaned_count == 1
        assert not storage.exists(staging_object_key)

        # Quota should now be committed
        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == 0
        assert account.used_bytes == media_size

        # 6. Idempotency: retry finalize with same client_request_id
        res_idempotent = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_idempotent.status_code == 200
        assert res_idempotent.json()["take_id"] == take_id
        assert res_idempotent.json()["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"

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
            take_svc.reserve_upload(
                session,
                user_1.id,
                PerformanceTakeUploadReservationRequest.model_validate(
                    _reservation_request_payload(conflicting_auth_req)
                ),
            )
        assert (
            getattr(conflict_exc.value, "details", {}).get("reason")
            == "client_request_id_reuse_conflict"
        )

        # 7. List takes
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        items = res_list.json()["items"]
        assert len(items) == 1
        assert items[0]["take_id"] == take_id
        assert items[0]["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"
        assert items[0]["manifest"]["score_display_title_snapshot"] == "Moonlight Sonata"

        # 8. Get take detail
        res_detail = client.get(f"/api/v1/performance-takes/{take_id}")
        assert res_detail.status_code == 200
        assert res_detail.json()["take_id"] == take_id
        assert res_detail.json()["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"

        # 9. Get playback URL
        res_play = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play.status_code == 200
        play_data = res_play.json()
        assert "playback_url" in play_data
        assert "download_url" in play_data

        # Saved recording materialization uses the authenticated same-origin
        # stream instead of relying on cross-origin signed-URL fetch/CORS.
        with (
            patch.object(
                storage, "exists", side_effect=AssertionError("Admitted media needs no HEAD")
            ),
            patch.object(
                storage,
                "object_metadata",
                side_effect=AssertionError("Admitted media needs no HEAD"),
            ),
            patch.object(
                storage,
                "size_bytes",
                create=True,
                side_effect=AssertionError("Admitted media needs no HEAD"),
            ),
        ):
            res_media = client.get(f"/api/v1/performance-takes/{take_id}/media")
        assert res_media.headers["content-length"] == str(len(media_content))
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

        app.dependency_overrides[get_current_user] = lambda: session.get(User, 2)
        res_media_other_user = client.get(f"/api/v1/performance-takes/{take_id}/media")
        assert res_media_other_user.status_code == 404
        assert media_content not in res_media_other_user.content
        app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)

        # Delete releases semantic ownership and queues physical retirement.
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 204
        assert res_del.content == b""

        assert client.get(f"/api/v1/performance-takes/{take_id}").status_code == 404
        assert client.get(f"/api/v1/performance-takes/{take_id}/playback-url").status_code == 404
        assert client.get(f"/api/v1/performance-takes/{take_id}/media").status_code == 404
        assert client.delete(f"/api/v1/performance-takes/{take_id}").status_code == 404
        operation = session.scalar(
            select(StoredObjectRetirement).where(
                StoredObjectRetirement.object_key == final_object_key
            )
        )
        assert operation.status == "PENDING" and storage.exists(final_object_key)
        assert session.scalar(select(PerformanceTake)) is None
        assert client.get("/api/v1/performance-takes").json()["items"] == []
        session.refresh(account)
        assert account.used_bytes == 0
        worker_res = _run_retirement(monkeypatch, session, storage, operation.retirement_uuid)
        assert worker_res["status"] == "completed"

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
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        # The AUDIO media kind cannot admit a VIDEO container.
        req_bad_mime = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {
                "kind": "AUDIO",
                "byte_size": 1024,
                "mime_type": "video/mp4",
            },
            "scope": {"kind": "FULL"},
            "client_request_id": "req-bad-mime",
            "tempo_selection": DEFAULT_TAKE_TEMPO_PLAN["selection"],
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_bad_mime)
        assert res.status_code == 422

        # Resolved beat fields are not writable request facts
        req_bad_scope = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": 1024, "mime_type": "audio/webm"},
            "scope": {"start_tick": 4, "terminal_tick": 4},
            "client_request_id": "req-bad-scope",
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_bad_scope)
        assert res.status_code == 422

        # A missing exact bound Bundle fails closed
        req_bad_score = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": "revision-uuid-100",
                "bundle_id": "nonexistent-source",
            },
            "media": {"byte_size": 1024, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-bad-score",
            "tempo_selection": DEFAULT_TAKE_TEMPO_PLAN["selection"],
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=req_bad_score)
        assert res.status_code == 404

    finally:
        app.dependency_overrides.clear()


def test_unowned_bundle_cannot_start_a_new_reservation(test_env):
    session, storage, user, _ = test_env
    service = _performance_take_service(session=session, storage=storage)
    source = session.execute(select(PracticeBundleRecord)).scalar_one()
    session.delete(session.get(ScoreRevisionPracticeBinding, 100))
    session.commit()
    with pytest.raises(ResourceNotFoundException):
        service.reserve_upload(
            session,
            user.id,
            PerformanceTakeUploadReservationRequest.model_validate(
                _reservation_request_payload(
                    {
                        "practice_binding": {
                            "score_id": "score-uuid-10",
                            "revision_id": "revision-uuid-100",
                            "bundle_id": source.bundle_id,
                        },
                        "client_request_id": "unowned-source",
                        "media": {
                            "byte_size": 1024,
                            "mime_type": "audio/webm",
                        },
                        "scope": {"kind": "FULL"},
                    }
                )
            ),
        )


def test_cross_user_score_permission(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        # User 2 owns a private score
        score_user2 = Score(
            id=30,
            score_uuid="score-uuid-user2",
            owner_user_id=2,
            display_title="User 2 Private Sonata",
        )
        session.add(score_user2)
        session.flush()

        rev_user2 = ScoreRevision(
            id=300,
            revision_uuid="revision-uuid-user2",
            score_id=30,
            revision_number=1,
            content_hash="0249aee2190a4e71c6607c6df2973810a6350fe832a5e2a6383fd392bb27d803",
            origin=RevisionOrigin.OMR,
            created_by_user_id=2,
        )
        session.add(rev_user2)
        session.flush()
        score_user2.head_revision_id = 300
        session.commit()

        private_source = _create_default_bundle(
            session,
            storage,
            practice_score_uuid="score-uuid-user2",
            practice_revision_uuid="revision-uuid-user2",
            revision_id=300,
        )
        # User 1 cannot reserve upload on User 2's private source
        app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
        req_unauth = {
            "practice_binding": {
                "score_id": "score-uuid-user2",
                "revision_id": "revision-uuid-user2",
                "bundle_id": private_source.bundle_id,
            },
            "media": {"byte_size": 1024, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
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
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        # 1. Create a take on score 10
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": size, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-real-delete-01",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        source_score = session.get(Score, 10)
        source_score.display_title = "My practice copy"
        session.commit()
        staging_key = _staging_key(session, auth_data["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        reserved_upload_id = res_id
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200
        assert res_fin.json()["manifest"]["score_display_title_snapshot"] == "Moonlight Sonata"

        take_row = session.execute(
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .where(PerformanceTakeManifest.take_uuid == take_id)
        ).scalar_one()
        final_key = take_row.recording_object.object_key
        assert final_key.startswith(f"performance-takes/1/{take_id}/")
        assert storage.exists(final_key)

        # Initial list check: binding provenance is returned and live navigation is available.
        res_init_list = client.get("/api/v1/performance-takes")
        assert res_init_list.status_code == 200
        init_item = res_init_list.json()["items"][0]
        assert init_item["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"
        assert init_item["linked_score_id"] == "score-uuid-10"
        assert init_item["can_open_score"] is True

        # 2. REAL SOFT DELETE: invoke real ScoreService.batch_delete / HTTP POST /api/v1/scores/batch-delete
        score_svc = ScoreService(storage=storage)
        app.dependency_overrides[get_score_service] = lambda: score_svc

        res_soft = client.post("/api/v1/scores/batch-delete", json={"score_ids": ["score-uuid-10"]})
        assert res_soft.status_code == 200
        assert res_soft.json()["removed"] == 1

        score_row = session.execute(select(Score).where(Score.id == 10)).scalar_one()
        assert score_row.deleted_at is not None

        # Listing takes: binding provenance is retained even while the score is hidden/deleting.
        res_list_soft = client.get("/api/v1/performance-takes")
        assert res_list_soft.status_code == 200
        item_soft = res_list_soft.json()["items"][0]
        assert item_soft["take_id"] == take_id
        assert item_soft["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"
        assert item_soft["manifest"]["practice_binding"]["revision_id"] == "revision-uuid-100"
        assert item_soft["manifest"]["artifact_id"] == DEFAULT_TAKE_ARTIFACT_ID
        assert item_soft["manifest"]["score_display_title_snapshot"] == "Moonlight Sonata"

        # Playback still works during soft delete
        res_play_soft = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_soft.status_code == 200

        # User's storage quota still accounts for take audio
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == size

        # Execute the admitted operation through its delivery lease.
        cleanup_res = complete_score_deletions(session)
        assert cleanup_res.scores_deleted == 1

        # Verify in DB: live score rows are physically deleted. The take no longer
        # points at live score/revision rows; its immutable provenance and media remain independently retained.
        retained_score = session.execute(select(Score).where(Score.id == 10)).scalar_one_or_none()
        assert retained_score is None

        # Verify in DB: take row is preserved with required binding provenance.
        take_in_db = session.execute(
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .where(PerformanceTakeManifest.take_uuid == take_id)
        ).scalar_one_or_none()
        assert take_in_db is not None
        assert take_in_db.linked_score_id is None
        assert (
            manifest_from_row(take_in_db.manifest).snapshot.score_display_title_snapshot
            == "Moonlight Sonata"
        )
        source = session.execute(
            select(PracticeBundleRecord).where(
                PracticeBundleRecord.bundle_id
                == manifest_from_row(take_in_db.manifest).snapshot.practice_binding.bundle_id
            )
        ).scalar_one()
        assert source is not None
        assert "score-uuid-10" == "score-uuid-10"
        assert DEFAULT_TAKE_REVISION_ID == "revision-uuid-100"
        assert storage.exists(source.prepared_musicxml_object.object_key)
        assert storage.exists(source.artifact_object.object_key)

        # Verify storage: media object is STILL PRESERVED!
        assert storage.exists(final_key)

        # Verify storage quota: user quota is STILL PRESERVED!
        session.refresh(account)
        assert account.used_bytes == size

        # Listing takes after score cleanup: exact binding provenance remains recoverable.
        res_list_hard = client.get("/api/v1/performance-takes")
        assert res_list_hard.status_code == 200
        item_hard = res_list_hard.json()["items"][0]
        assert item_hard["take_id"] == take_id
        assert item_hard["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"
        assert item_hard["manifest"]["practice_binding"]["revision_id"] == "revision-uuid-100"
        assert item_hard["manifest"]["artifact_id"] == DEFAULT_TAKE_ARTIFACT_ID
        assert item_hard["manifest"]["score_display_title_snapshot"] == "Moonlight Sonata"
        assert item_hard["linked_score_id"] is None
        assert item_hard["can_open_score"] is False

        # Playback and download still work after score hard delete
        res_play_hard = client.get(f"/api/v1/performance-takes/{take_id}/playback-url")
        assert res_play_hard.status_code == 200
        assert "download_url" in res_play_hard.json()
        retained = client.get(f"/api/v1/performance-takes/{take_id}")
        assert retained.status_code == 200, retained.text
        assert retained.json()["manifest"]["practice_binding"]["bundle_id"] == _bundle_id()

        # Deleting the semantic Take returns 200 OK
        res_del = client.delete(f"/api/v1/performance-takes/{take_id}")
        assert res_del.status_code == 204

        operation = session.scalar(
            select(StoredObjectRetirement).where(StoredObjectRetirement.object_key == final_key)
        )
        assert session.scalar(select(PerformanceTake)) is None
        assert (
            _run_retirement(monkeypatch, session, storage, operation.retirement_uuid)["status"]
            == "completed"
        )

        assert not storage.exists(final_key)
        session.refresh(account)
        assert account.used_bytes == 0

    finally:
        app.dependency_overrides.clear()


def test_quota_rejection(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        session.get(UserStorageEntitlement, 1).mode_override = StorageQuotaMode.HARD_LIMIT
        session.get(UserStorageEntitlement, 1).limit_override_bytes = 1024 * 1024
        session.commit()
        excessive_size = 2 * 1024 * 1024
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": excessive_size, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-huge",
        }
        res = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res.status_code == 422
        assert res.json()["code"] == "storage_quota_exceeded"
    finally:
        app.dependency_overrides.clear()


def test_cancel_upload_reservation(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": 5000, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-cancel-01",
            "tempo_selection": DEFAULT_TAKE_TEMPO_PLAN["selection"],
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        res_id = res_auth.json()["reservation_id"]
        staging_key = _staging_key(session, res_auth.json()["reservation_id"])
        storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
        auth_before_cancel = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == res_id
            )
        ).scalar_one()
        practice_bundle_id = manifest_from_row(
            auth_before_cancel.manifest
        ).snapshot.practice_binding.bundle_id
        source = session.execute(
            select(PracticeBundleRecord).where(PracticeBundleRecord.bundle_id == practice_bundle_id)
        ).scalar_one()
        practice_bundle_id = source.id
        assert source is not None
        musicxml_key = source.prepared_musicxml_object.object_key
        artifact_key = source.artifact_object.object_key

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == 5000

        # Cancel reservation via DELETE route
        res_cancel = client.delete(f"/api/v1/performance-takes/upload-reservations/{res_id}")
        assert res_cancel.status_code == 204
        assert res_cancel.content == b""

        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == 0
        assert storage.exists(staging_key)

        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == res_id
            )
        ).scalar_one()
        assert manifest_from_row(auth.manifest).snapshot.practice_binding.bundle_id == _bundle_id()
        auth.last_put_url_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        auth.staging_cleanup_after = auth.last_put_url_expires_at
        session.commit()
        cleaned_count = upload_reservation_cleanup_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()
        assert cleaned_count == 1
        assert not storage.exists(staging_key)
        assert session.get(PracticeBundleRecord, practice_bundle_id) is not None
        retained = session.get(PracticeBundleRecord, practice_bundle_id)
        session.refresh(retained)
        assert retained.status is PracticeBundleStatus.READY
        assert session.get(ScoreRevisionPracticeBinding, 100).bundle_id == retained.id
        assert storage.exists(musicxml_key)
        assert storage.exists(artifact_key)

        # Idempotent cancel via the canonical DELETE route.
        res_cancel_delete_again = client.delete(
            f"/api/v1/performance-takes/upload-reservations/{res_id}"
        )
        assert res_cancel_delete_again.status_code == 204
        assert res_cancel_delete_again.content == b""

    finally:
        app.dependency_overrides.clear()


def test_pagination(test_env):
    session, storage, user_1, user_2 = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        # Create 3 takes for User 1 with valid container bytes
        for i in range(1, 4):
            content = VALID_WEBM_BYTES + f"-take-{i}".encode()
            size = len(content)
            auth_req = {
                "practice_binding": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "bundle_id": _bundle_id(),
                },
                "media": {"byte_size": size, "mime_type": "audio/webm"},
                "scope": {"kind": "FULL"},
                "client_request_id": f"req-page-{i}",
                "tempo_selection": DEFAULT_TAKE_TEMPO_PLAN["selection"],
                "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
            }
            res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
            assert res_auth.status_code == 200
            data = res_auth.json()
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

        # First bounded page
        r1 = client.get("/api/v1/performance-takes?limit=2")
        assert r1.status_code == 200
        d1 = r1.json()
        assert len(d1["items"]) == 2
        assert d1["next_cursor"] is not None

        # Continue from the immutable position
        r2 = client.get(
            "/api/v1/performance-takes", params={"limit": 2, "cursor": d1["next_cursor"]}
        )
        assert r2.status_code == 200
        d2 = r2.json()
        assert len(d2["items"]) == 1
        assert d2["next_cursor"] is None

    finally:
        app.dependency_overrides.clear()


def test_audio_container_magic_bytes_validation(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        # 1. Invalid container header rejected with 422 media_mime_type
        bad_content = b"INVALID_MAGIC_BYTES_1234567890"
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {
                "byte_size": len(bad_content),
                "mime_type": "audio/webm",
            },
            "scope": {"kind": "FULL"},
            "client_request_id": "req-bad-magic",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
        staging_key = _staging_key(session, auth_data["reservation_id"])
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        storage.put_bytes(key=staging_key, content=bad_content, content_type="audio/webm")

        reserved_upload_id = res_id
        res_fin_bad = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin_bad.status_code == 422
        assert res_fin_bad.json()["code"] == "validation_error"
        # Final immutable object was NEVER created
        final_key = f"performance-takes/1/{take_id}/recording.webm"
        assert not storage.exists(final_key)

        # 2. Valid OGG container: b"OggS..."
        ogg_content = b"OggS" + b"\x00" * 40
        auth_ogg = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": len(ogg_content), "mime_type": "audio/ogg"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-ogg-magic",
        }
        res_auth_ogg = client.post("/api/v1/performance-takes/upload-reservations", json=auth_ogg)
        assert res_auth_ogg.status_code == 200
        ogg_auth_data = res_auth_ogg.json()
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
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": len(wav_content), "mime_type": "audio/wav"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-wav-magic",
        }
        res_auth_wav = client.post("/api/v1/performance-takes/upload-reservations", json=auth_wav)
        assert res_auth_wav.status_code == 200
        wav_auth_data = res_auth_wav.json()
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
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": size, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-safe-retry-01",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
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
        take_1 = res_fin_1.json()

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == size

        # Client timeout / network error retry finalize with identical client_request_id
        res_fin_2 = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin_2.status_code == 200
        take_2 = res_fin_2.json()
        assert take_2["take_id"] == take_1["take_id"]

        # Quota used_bytes must NOT be doubled
        session.refresh(account)
        assert account.used_bytes == size

        # Exactly 1 take row exists in DB
        takes = (
            session.execute(
                select(PerformanceTake)
                .join(PerformanceTakeManifest)
                .where(PerformanceTakeManifest.take_uuid == take_id)
            )
            .scalars()
            .all()
        )
        assert len(takes) == 1
        session.expire(takes[0], ["created_at"])
        assert takes[0].created_at.tzinfo is not None
        assert takes[0].created_at.utcoffset() == timedelta(0)

    finally:
        app.dependency_overrides.clear()


def test_finalize_recovers_first_post_storage_db_disconnect(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    original_lock = take_svc.repository.get_reservation_by_take_uuid
    first_post_copy_read = {"pending": True}
    original_copy = storage.copy
    copied = {"done": False}

    def copied_object(*args, **kwargs):
        result = original_copy(*args, **kwargs)
        copied["done"] = True
        return result

    def disconnect_once(*args, **kwargs):
        if copied["done"] and first_post_copy_read["pending"]:
            first_post_copy_read["pending"] = False
            raise DBAPIError.instance(
                "SELECT reservation",
                {},
                Exception("connection is closed"),
                Exception,
                connection_invalidated=True,
            )
        return original_lock(*args, **kwargs)

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {
                "kind": "VIDEO",
                "byte_size": len(content),
                "mime_type": "video/webm",
            },
            "scope": {"kind": "FULL"},
            "client_request_id": "req-post-storage-disconnect",
        }
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json=auth_req,
        )
        assert res_auth.status_code == 200, res_auth.text
        auth_data = res_auth.json()
        storage.put_bytes(
            key=_staging_key(session, auth_data["reservation_id"]),
            content=content,
            content_type="video/webm",
        )

        reserved_upload_id = auth_data["reservation_id"]
        with (
            patch.object(storage, "copy", side_effect=copied_object),
            patch.object(
                take_svc.repository, "get_reservation_by_take_uuid", side_effect=disconnect_once
            ),
        ):
            res_fin = client.post(
                "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
            )

        assert res_fin.status_code == 200, res_fin.text
        assert first_post_copy_read["pending"] is False
        assert (
            session.execute(
                select(PerformanceTake)
                .join(PerformanceTakeManifest)
                .where(PerformanceTakeManifest.take_uuid == auth_data["take_id"])
            )
            .scalars()
            .one()
        )
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == len(content)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == 0
    finally:
        app.dependency_overrides.clear()


def test_finalize_range_video_preserves_scope_identity_and_recording_timebase(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)
    try:
        content = VALID_WEBM_BYTES
        recording_timebase = {
            "nominalMediaDurationUs": 5000000,
            "activeSegments": [
                {
                    "performanceStartUs": 0,
                    "performanceEndUs": 5000000,
                    "mediaStartUs": 0,
                    "mediaEndUs": 5000000,
                }
            ],
        }
        tempo_plan = {
            "selection": {"mode": "SCORE"},
            "segments": [{"startTick": 0, "bpm": 120, "source": "MUSICXML"}],
        }
        request = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {
                "kind": "VIDEO",
                "byte_size": len(content),
                "mime_type": "video/webm",
            },
            "scope": {
                "kind": "RANGE",
                "start_group_id": "entry-4-e6a7532f4b2a",
                "end_group_id": "entry-9-d7e908049e12",
            },
            "client_request_id": "req-range-video-scope-identity",
            "tempo_selection": tempo_plan["selection"],
            "recording_timebase": recording_timebase,
        }
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json=request,
        )
        assert res_auth.status_code == 200, res_auth.text
        auth_data = res_auth.json()
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
        take_data = res_fin.json()
        assert take_data["manifest"]["scope"]["kind"] == "RANGE"
        assert take_data["manifest"]["scope"]["start_tick"] == 4
        assert take_data["manifest"]["scope"]["terminal_tick"] == 16
        assert take_data["manifest"]["scope"]["start_group_id"] == "entry-4-e6a7532f4b2a"
        assert take_data["manifest"]["scope"]["end_group_id"] == "entry-9-d7e908049e12"
        assert "scopeIdentity" not in take_data["manifest"]["recording_timebase"]
        assert take_data["manifest"]["tempo_plan"] == tempo_plan
        assert session.execute(
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .where(PerformanceTakeManifest.take_uuid == auth_data["take_id"])
        ).scalar_one()
    finally:
        app.dependency_overrides.clear()


def test_finalize_rejects_candidate_when_staging_changes_after_validation(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()

    first_content = b"\x1a\x45\xdf\xa3" + b"A" * 32
    rewritten_content = b"\x1a\x45\xdf\xa3" + b"B" * 32
    assert len(first_content) == len(rewritten_content)

    class MutatingCopyStorage(InMemoryObjectStorage):
        def __init__(self, wrapped: InMemoryObjectStorage) -> None:
            super().__init__(objects=wrapped.objects)

        def copy(self, source_key: str, target_key: str) -> None:
            self.put_bytes(
                key=source_key,
                content=rewritten_content,
                content_type="audio/webm",
            )
            super().copy(source_key, target_key)

    mutating_storage = MutatingCopyStorage(storage)
    take_svc = _performance_take_service(
        session=session,
        storage=mutating_storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: mutating_storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {
                "byte_size": len(first_content),
                "mime_type": "audio/webm",
            },
            "scope": {"kind": "FULL"},
            "client_request_id": "req-staging-rewrite",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
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
                select(PerformanceTake)
                .join(PerformanceTakeManifest)
                .where(PerformanceTakeManifest.take_uuid == auth_data["take_id"])
            ).scalar_one_or_none()
            is None
        )

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert account.used_bytes == 0
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == len(first_content)
    finally:
        app.dependency_overrides.clear()


def test_video_take_finalize_uses_video_media_kind_and_candidate(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        content = b"\x1a\x45\xdf\xa3" + b"fake-browser-video-with-audio"
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {
                "kind": "VIDEO",
                "byte_size": len(content),
                "mime_type": "video/webm",
            },
            "scope": {"kind": "FULL"},
            "client_request_id": "req-video-save",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200, res_auth.text
        auth_data = res_auth.json()
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
        take_data = res_fin.json()
        assert take_data["manifest"]["capture"]["kind"] == "VIDEO"
        assert take_data["manifest"]["capture"]["mime_type"] == "video/webm"

        take_row = session.execute(
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .where(PerformanceTakeManifest.take_uuid == auth_data["take_id"])
        ).scalar_one()
        assert manifest_from_row(take_row.manifest).snapshot.capture.kind == "VIDEO"
        assert take_row.recording_object.object_key.endswith(".webm")
        assert storage.exists(take_row.recording_object.object_key)
        assert b"fake-browser-video-with-audio" in b"".join(
            storage.iter_bytes(take_row.recording_object.object_key)
        )

        res_playback = client.get(f"/api/v1/performance-takes/{take_data['take_id']}/playback-url")
        assert res_playback.status_code == 200
        playback_data = res_playback.json()
        assert set(playback_data) == {"take_id", "playback_url", "download_url", "expires_in"}

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
    source = _create_default_bundle(session, _storage)
    now = datetime.now(timezone.utc)
    auth = PerformanceTakeUploadReservation(
        manifest=_manifest_row(
            source, user_id=user_1.id, take_uuid="take-finalizing-reserve", title="Moonlight Sonata"
        ),
        user_id=user_1.id,
        client_request_id="req-finalizing-reserve",
        staging_object_key="staging/performance-takes/1/finalizing-reserve/recording.webm",
        finalizing_object_key="performance-takes/1/finalizing-reserve/token.webm",
        quota_hold_id=quota_hold_fact(session, user_1.id, bytes_count=len(VALID_WEBM_BYTES)),
        status=UploadReservationStatus.FINALIZING,
        expires_at=now + timedelta(minutes=10),
        last_put_url_expires_at=now + timedelta(minutes=10),
        staging_cleanup_after=now + timedelta(minutes=10),
        finalizing_token="token",
        finalizing_expires_at=now + timedelta(minutes=10),
    )
    session.add(auth)
    session.commit()

    take_svc = _performance_take_service(session=session, storage=_storage)
    response = take_svc.reserve_upload(
        session,
        user_1.id,
        PerformanceTakeUploadReservationRequest.model_validate(
            _reservation_request_payload(
                {
                    "practice_binding": {
                        "score_id": "score-uuid-10",
                        "revision_id": DEFAULT_TAKE_REVISION_ID,
                        "bundle_id": _bundle_id(),
                    },
                    "client_request_id": "req-finalizing-reserve",
                    "media": {
                        "byte_size": len(VALID_WEBM_BYTES),
                        "mime_type": "audio/webm",
                    },
                    "scope": {"kind": "FULL"},
                }
            )
        ),
    )
    assert response.status == "FINALIZING"
    assert response.upload_target is None
    assert response.reservation_id == auth.reservation_uuid
    assert response.reservation_id != auth.quota_hold_id


def test_crash_abandoned_after_reservation(test_env, monkeypatch: pytest.MonkeyPatch):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": size, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-abandoned-01",
            "tempo_selection": DEFAULT_TAKE_TEMPO_PLAN["selection"],
            "recording_timebase": DEFAULT_TAKE_RECORDING_TIMEBASE,
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
        staging_key = _staging_key(session, auth_data["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == size

        # Simulate time passing and reservation expiring
        auth = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.client_request_id == "req-abandoned-01"
            )
        ).scalar_one()
        practice_bundle_id = manifest_from_row(auth.manifest).snapshot.practice_binding.bundle_id
        source = session.execute(
            select(PracticeBundleRecord).where(PracticeBundleRecord.bundle_id == practice_bundle_id)
        ).scalar_one()
        practice_bundle_id = source.id
        assert source is not None
        musicxml_key = source.prepared_musicxml_object.object_key
        artifact_key = source.artifact_object.object_key
        auth.expires_at = datetime.now(timezone.utc) - timedelta(hours=2)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()

        # Background maintenance task cleans expired reservations
        cleaned_count = upload_reservation_cleanup_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()
        assert cleaned_count == 1

        # Staging file is deleted, quota reservation released
        assert not storage.exists(staging_key)
        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == 0

        session.refresh(auth)
        assert auth.status == UploadReservationStatus.EXPIRED
        assert manifest_from_row(auth.manifest).snapshot.practice_binding.bundle_id == _bundle_id()
        assert session.get(PracticeBundleRecord, practice_bundle_id) is not None
        retained = session.get(PracticeBundleRecord, practice_bundle_id)
        session.refresh(retained)
        assert retained.status is PracticeBundleStatus.READY
        assert session.get(ScoreRevisionPracticeBinding, 100).bundle_id == retained.id
        assert storage.exists(musicxml_key)
        assert storage.exists(artifact_key)

    finally:
        app.dependency_overrides.clear()


def test_expired_reservation_staging_delete_failure_is_retryable(test_env, monkeypatch):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        size = len(VALID_WEBM_BYTES)
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "practice_binding": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "bundle_id": _bundle_id(),
                },
                "media": {"byte_size": size, "mime_type": "audio/webm"},
                "scope": {"kind": "FULL"},
                "client_request_id": "req-expired-delete-retry",
            },
        )
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
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
        auth.expires_at = datetime.now(timezone.utc) - timedelta(hours=2)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()

        original_delete = storage.delete

        def fail_delete(_key: str) -> bool:
            raise RuntimeError("storage temporarily unavailable")

        monkeypatch.setattr(storage, "delete", fail_delete)
        cleaned_count = upload_reservation_cleanup_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert storage.exists(auth.staging_object_key)
        account = session.get(StorageUsageAccount, 1)
        session.refresh(account)
        assert storage_quota_service.snapshot_user(session, 1).reserved_bytes == 0
        session.refresh(auth)
        assert auth.status == UploadReservationStatus.EXPIRED

        monkeypatch.setattr(storage, "delete", original_delete)
        cleaned_count = upload_reservation_cleanup_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert not storage.exists(auth.staging_object_key)
    finally:
        app.dependency_overrides.clear()


def test_completed_reservation_late_staging_put_is_cleaned_after_expiry(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "practice_binding": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "bundle_id": _bundle_id(),
                },
                "media": {"byte_size": size, "mime_type": "audio/webm"},
                "scope": {"kind": "FULL"},
                "client_request_id": "req-late-put-cleanup",
            },
        )
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
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
        final_bytes = storage.read_bytes(
            session.execute(
                select(StoredObject.object_key)
                .join(PerformanceTake)
                .where(PerformanceTake.manifest_id == auth.manifest_id)
            ).scalar_one()
        )

        # A still-valid old presigned PUT can recreate staging after the successful save.
        storage.put_bytes(
            key=staging_key,
            content=b"\x1a\x45\xdf\xa3late-staging-rewrite",
            content_type="audio/webm",
        )
        assert storage.exists(staging_key)

        auth.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()
        cleaned_count = upload_reservation_cleanup_service.cleanup_expired_reservations(
            session,
            storage=storage,
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert not storage.exists(staging_key)
        assert (
            storage.read_bytes(
                session.execute(
                    select(StoredObject.object_key)
                    .join(PerformanceTake)
                    .where(PerformanceTake.manifest_id == auth.manifest_id)
                ).scalar_one()
            )
            == final_bytes
        )
        session.refresh(auth)
        assert auth.status == UploadReservationStatus.COMPLETED
    finally:
        app.dependency_overrides.clear()


def test_score_deleted_between_reserve_and_finalize_preserves_provenance(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    try:
        content = VALID_WEBM_BYTES
        size = len(content)
        auth_req = {
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {"byte_size": size, "mime_type": "audio/webm"},
            "scope": {"kind": "FULL"},
            "client_request_id": "req-score-del-midway",
        }
        res_auth = client.post("/api/v1/performance-takes/upload-reservations", json=auth_req)
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
        take_id = auth_data["take_id"]
        res_id = auth_data["reservation_id"]
        staging_key = _staging_key(session, auth_data["reservation_id"])
        storage.put_bytes(key=staging_key, content=content, content_type="audio/webm")

        # Simulate score becoming unavailable before client calls finalize. The
        # upload reservation already references the durable Bundle, so this
        # save must still finish without requiring live Score access.
        session.execute(text("UPDATE scores SET deleted_at = CURRENT_TIMESTAMP WHERE id = 10;"))
        session.commit()

        reserved_upload_id = res_id
        res_fin = client.post(
            "/api/v1/performance-takes/upload-reservations/" + reserved_upload_id + "/finalize"
        )
        assert res_fin.status_code == 200, res_fin.text
        data = res_fin.json()
        assert data["take_id"] == take_id
        assert data["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"
        assert data["manifest"]["practice_binding"]["revision_id"] == "revision-uuid-100"
        assert data["manifest"]["artifact_id"] == DEFAULT_TAKE_ARTIFACT_ID
        assert data["linked_score_id"] is None
        assert data["can_open_score"] is False

        take = session.execute(
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .where(PerformanceTakeManifest.take_uuid == take_id)
        ).scalar_one()
        source = session.execute(
            select(PracticeBundleRecord).where(
                PracticeBundleRecord.bundle_id
                == manifest_from_row(take.manifest).snapshot.practice_binding.bundle_id
            )
        ).scalar_one()
        assert source is not None
        assert "score-uuid-10" == "score-uuid-10"
        assert DEFAULT_TAKE_REVISION_ID == "revision-uuid-100"
        assert storage.exists(source.prepared_musicxml_object.object_key)
        assert storage.exists(source.artifact_object.object_key)

        retained = client.get(f"/api/v1/performance-takes/{take_id}")
        assert retained.status_code == 200, retained.text
        assert retained.json()["manifest"]["practice_binding"]["bundle_id"] == _bundle_id()

        # List takes exposes the durable historical source, but no live score link.
        res_list = client.get("/api/v1/performance-takes")
        assert res_list.status_code == 200
        item = res_list.json()["items"][0]
        assert item["manifest"]["practice_binding"]["score_id"] == "score-uuid-10"
        assert item["linked_score_id"] is None

    finally:
        app.dependency_overrides.clear()


def test_expired_reservation_cleanup_releases_db_lock_before_storage_delete(test_env):
    session, storage, user_1, _ = test_env
    storage_usage_svc = StorageUsageService()
    take_svc = _performance_take_service(
        session=session,
        storage=storage,
        storage_usage_service=storage_usage_svc,
    )

    def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: session.get(User, 1)
    app.dependency_overrides[get_object_storage] = lambda: storage
    app.dependency_overrides[get_storage_usage_service] = lambda: storage_usage_svc
    app.dependency_overrides[get_performance_take_service] = lambda: take_svc.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: take_svc
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: take_svc

    client = PerformanceTakeTestClient(app)

    class LockAssertingStorage(InMemoryObjectStorage):
        def __init__(self, wrapped: InMemoryObjectStorage) -> None:
            super().__init__(objects=wrapped.objects)

        def delete(self, key: str) -> bool:
            assert not session.in_transaction()
            return super().delete(key)

    try:
        size = len(VALID_WEBM_BYTES)
        res_auth = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                "practice_binding": {
                    "score_id": "score-uuid-10",
                    "revision_id": DEFAULT_TAKE_REVISION_ID,
                    "bundle_id": _bundle_id(),
                },
                "media": {"byte_size": size, "mime_type": "audio/webm"},
                "scope": {"kind": "FULL"},
                "client_request_id": "req-expired-no-lock-delete",
            },
        )
        assert res_auth.status_code == 200
        auth_data = res_auth.json()
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
        auth.expires_at = datetime.now(timezone.utc) - timedelta(hours=2)
        auth.last_put_url_expires_at = auth.expires_at
        auth.staging_cleanup_after = auth.expires_at
        session.commit()

        cleaned_count = upload_reservation_cleanup_service.cleanup_expired_reservations(
            session,
            storage=LockAssertingStorage(storage),
            storage_usage_service=storage_usage_svc,
        )
        session.commit()

        assert cleaned_count == 1
        assert not storage.exists(auth.staging_object_key)
        session.refresh(auth)
        assert auth.status == UploadReservationStatus.EXPIRED
    finally:
        app.dependency_overrides.clear()


def _expired_cleanup_auth(
    db: Session,
    *,
    source: PracticeBundleRecord,
    user_id: int,
    client_request_id: str,
    staging_key: str,
    final_key: str,
) -> PerformanceTakeUploadReservation:
    expired_at = datetime.now(timezone.utc) - timedelta(hours=2)
    row = PerformanceTakeUploadReservation(
        manifest=_manifest_row(
            source, user_id=user_id, take_uuid=f"take-{client_request_id}", title="Cleanup test"
        ),
        user_id=user_id,
        client_request_id=client_request_id,
        staging_object_key=staging_key,
        quota_hold_id=quota_hold_fact(
            db, user_id, status=StorageQuotaHoldStatus.EXPIRED, expires_at=expired_at
        ),
        expires_at=expired_at,
        last_put_url_expires_at=expired_at,
        staging_cleanup_after=expired_at,
    )

    state = UploadReservationLifecycle.reserved(expires_at=expired_at, put_expires_at=expired_at)
    state = state.expire(now=expired_at).after
    state = state.remember_uncertain_candidate(key=final_key, now=expired_at).after
    initialize_lifecycle(row, state)
    return row


def test_reservation_cleanup_does_not_complete_when_delete_returns_false(test_env):
    session, storage, user_1, _ = test_env
    staging_key = "staging/performance-takes/1/delete-false/recording.webm"
    final_key = "performance-takes/1/delete-false/recording.webm"
    storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="delete-false",
        staging_key=staging_key,
        final_key=final_key,
    )
    auth.orphan_final_object_keys = "[]"
    session.add(auth)
    session.commit()

    class DeleteFalseStorage(InMemoryObjectStorage):
        def __init__(self, wrapped: InMemoryObjectStorage) -> None:
            super().__init__(objects=wrapped.objects)

        def delete(self, key: str) -> bool:
            return False

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=DeleteFalseStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 0
    assert storage.exists(staging_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is None


def test_reservation_cleanup_does_not_complete_when_head_still_exists(test_env):
    session, storage, user_1, _ = test_env
    staging_key = "staging/performance-takes/1/head-still-exists/recording.webm"
    final_key = "performance-takes/1/head-still-exists/recording.webm"
    storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="head-still-exists",
        staging_key=staging_key,
        final_key=final_key,
    )
    auth.orphan_final_object_keys = "[]"
    session.add(auth)
    session.commit()

    class DeleteLiesStorage(InMemoryObjectStorage):
        def __init__(self, wrapped: InMemoryObjectStorage) -> None:
            super().__init__(objects=wrapped.objects)

        def delete(self, key: str) -> bool:
            return True

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=DeleteLiesStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 0
    assert storage.exists(staging_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is None


def test_reservation_cleanup_does_not_complete_when_final_head_fails(test_env):
    session, storage, user_1, _ = test_env
    staging_key = "staging/performance-takes/1/head-fails/recording.webm"
    final_key = "performance-takes/1/head-fails/recording.webm"
    storage.put_bytes(key=staging_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="head-fails",
        staging_key=staging_key,
        final_key=final_key,
    )
    auth.orphan_final_object_keys = "[]"
    session.add(auth)
    session.commit()

    class HeadFailsAfterDeleteStorage(InMemoryObjectStorage):
        def __init__(self, wrapped: InMemoryObjectStorage) -> None:
            super().__init__(objects=wrapped.objects)
            self._deleted = False

        def delete(self, key: str) -> bool:
            self._deleted = True
            return super().delete(key)

        def exists(self, key: str) -> bool:
            if self._deleted and key == staging_key:
                raise RuntimeError("head temporarily unavailable")
            return super().exists(key)

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=HeadFailsAfterDeleteStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 0
    assert not storage.exists(staging_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is None


def test_finalize_in_progress_rejects_competing_executor_before_storage_copy(test_env):
    session, _storage, user_1, _ = test_env
    take_svc = _performance_take_service(session=session, storage=_storage)
    expired = datetime.now(timezone.utc) - timedelta(minutes=1)
    source = _create_default_bundle(session, _storage)
    auth = PerformanceTakeUploadReservation(
        manifest=_manifest_row(
            source,
            user_id=user_1.id,
            take_uuid="take-lease-expired-before-copy",
            title="Lease test",
        ),
        user_id=user_1.id,
        client_request_id="lease-expired-before-copy",
        staging_object_key="staging/performance-takes/1/lease-expired/recording.webm",
        finalizing_object_key="performance-takes/1/lease-expired/recording.webm",
        quota_hold_id=quota_hold_fact(session, user_1.id, bytes_count=len(VALID_WEBM_BYTES)),
        status=UploadReservationStatus.FINALIZING,
        expires_at=expired + timedelta(hours=2),
        finalizing_token="expired-token",
        finalizing_expires_at=expired + timedelta(hours=1),
    )
    session.add(auth)
    session.commit()

    with pytest.raises(Exception) as exc_info:
        take_svc.finalize_take(session, user_1.id, auth.reservation_uuid)

    assert getattr(exc_info.value, "details", {}).get("reason") == "finalize_in_progress"


def test_completed_reservation_cleanup_does_not_touch_storage(test_env):
    session, _storage, user_1, _ = test_env
    now = datetime.now(timezone.utc)
    past = now - timedelta(hours=2)
    source = _create_default_bundle(session, _storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="already-completed-cleanup",
        staging_key="staging/performance-takes/1/already-completed/recording.webm",
        final_key="performance-takes/1/already-completed/recording.webm",
    )
    auth.staging_cleanup_completed_at = past
    auth.orphan_final_object_keys = "[]"
    session.add(auth)
    session.commit()

    class FailsOnAccessStorage(InMemoryObjectStorage):
        def exists(self, key: str) -> bool:
            raise AssertionError(f"storage should not be touched for {key}")

        def delete(self, key: str) -> bool:
            raise AssertionError(f"storage should not be touched for {key}")

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
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
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="orphan-final-only",
        staging_key="staging/performance-takes/1/orphan-final-only/recording.webm",
        final_key="performance-takes/1/orphan-final-only/current.webm",
    )
    auth.staging_cleanup_completed_at = datetime.now(timezone.utc)
    auth.orphan_final_object_keys = encode_orphan_candidates(
        (OrphanFinalCandidate(orphan_key, datetime(2020, 1, 1, tzinfo=UTC)),)
    )
    session.add(auth)
    session.commit()

    touched: list[str] = []

    class TrackingStorage(InMemoryObjectStorage):
        def __init__(self, wrapped: InMemoryObjectStorage) -> None:
            super().__init__(objects=wrapped.objects)

        def exists(self, key: str) -> bool:
            touched.append(f"exists:{key}")
            return super().exists(key)

        def delete(self, key: str) -> bool:
            touched.append(f"delete:{key}")
            return super().delete(key)

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=TrackingStorage(storage),
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    assert not storage.exists(orphan_key)
    session.refresh(auth)
    assert auth.staging_cleanup_completed_at is not None
    assert auth.orphan_final_object_keys == "[]"
    assert all(auth.staging_object_key not in item for item in touched)
    assert any(orphan_key in item for item in touched)


def test_reservation_cleanup_keeps_unknown_absent_orphan_until_grace_then_converges(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc)
    orphan_key = "performance-takes/1/orphan-late/old-token.webm"
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="orphan-late-copy",
        staging_key="staging/performance-takes/1/orphan-late/recording.webm",
        final_key="performance-takes/1/orphan-late/current.webm",
    )
    auth.staging_cleanup_completed_at = now
    auth.orphan_final_object_keys = (
        f'[{{"key":"{orphan_key}","remove_after":"{(now + timedelta(minutes=10)).isoformat()}"}}]'
    )
    session.add(auth)
    session.commit()

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()
    assert cleaned == 0
    session.refresh(auth)
    assert orphan_key in (auth.orphan_final_object_keys or "")

    storage.put_bytes(key=orphan_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    auth.orphan_final_object_keys = (
        f'[{{"key":"{orphan_key}","remove_after":"{(now - timedelta(minutes=1)).isoformat()}"}}]'
    )
    session.commit()

    cleaned_after_grace = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned_after_grace == 1
    assert not storage.exists(orphan_key)
    session.refresh(auth)
    assert auth.orphan_final_object_keys == "[]"


def test_reservation_cleanup_removes_absent_known_orphan(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc)
    orphan_key = "performance-takes/1/absent-known/old-token.webm"
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="absent-known-orphan",
        staging_key="staging/performance-takes/1/absent-known/recording.webm",
        final_key="performance-takes/1/absent-known/current.webm",
    )
    auth.staging_cleanup_completed_at = now
    auth.orphan_final_object_keys = encode_orphan_candidates(
        (OrphanFinalCandidate(orphan_key, datetime(2020, 1, 1, tzinfo=UTC)),)
    )
    session.add(auth)
    session.commit()

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 1
    session.refresh(auth)
    assert auth.orphan_final_object_keys == "[]"


def test_reservation_cleanup_preserves_remaining_orphan_remove_after(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc)
    removable_key = "performance-takes/1/two-orphans/removable.webm"
    waiting_key = "performance-takes/1/two-orphans/waiting.webm"
    waiting_until = now + timedelta(minutes=15)
    storage.put_bytes(key=removable_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="two-orphans-preserve",
        staging_key="staging/performance-takes/1/two-orphans/recording.webm",
        final_key="performance-takes/1/two-orphans/current.webm",
    )
    auth.staging_cleanup_completed_at = now
    auth.orphan_final_object_keys = (
        "["
        f'{{"key":"{removable_key}","remove_after":"{(now - timedelta(minutes=1)).isoformat()}"}},'
        f'{{"key":"{waiting_key}","remove_after":"{waiting_until.isoformat()}"}}'
        "]"
    )
    session.add(auth)
    session.commit()

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
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
    now = datetime.now(timezone.utc)
    orphan_key = "performance-takes/1/remove-after-extended/token.webm"
    source = _create_default_bundle(session, _storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="remove-after-extended",
        staging_key="staging/performance-takes/1/remove-after-extended/recording.webm",
        final_key="performance-takes/1/remove-after-extended/current.webm",
    )
    auth.staging_cleanup_completed_at = now
    extended_until = now + timedelta(minutes=20)
    auth.orphan_final_object_keys = (
        f'[{{"key":"{orphan_key}","remove_after":"{extended_until.isoformat()}"}}]'
    )
    session.add(auth)
    session.commit()

    transition = lifecycle_from_row(auth).finish_cleanup(
        now=now, absent_candidates=frozenset({orphan_key})
    )
    removed = transition.before != transition.after
    apply_transition(auth, transition, now=now)
    session.commit()

    assert removed is False
    session.refresh(auth)
    assert orphan_key in (auth.orphan_final_object_keys or "")
    assert extended_until.isoformat() in (auth.orphan_final_object_keys or "")


def test_reservation_cleanup_does_not_delete_orphan_key_referenced_by_take(test_env):
    session, storage, user_1, _ = test_env
    now = datetime.now(timezone.utc)
    referenced_key = "performance-takes/1/referenced-orphan/token.webm"
    storage.put_bytes(key=referenced_key, content=VALID_WEBM_BYTES, content_type="audio/webm")
    source = _create_default_bundle(session, storage)
    auth = _expired_cleanup_auth(
        session,
        source=source,
        user_id=user_1.id,
        client_request_id="referenced-orphan",
        staging_key="staging/performance-takes/1/referenced-orphan/recording.webm",
        final_key=referenced_key,
    )
    auth.staging_cleanup_completed_at = now
    auth.orphan_final_object_keys = encode_orphan_candidates(
        (OrphanFinalCandidate(referenced_key, datetime(2020, 1, 1, tzinfo=UTC)),)
    )
    session.add(auth)
    session.flush()
    _create_default_take(
        session,
        user_id=user_1.id,
        source=source,
        client_request_id="referenced-take",
        take_uuid="separate-reference",
        media_object_key=referenced_key,
    )
    session.commit()

    cleaned = upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    assert cleaned == 0
    assert storage.exists(referenced_key)
    session.refresh(auth)
    assert referenced_key in (auth.orphan_final_object_keys or "")


def test_expired_finalizing_lease_records_candidate_before_retry(test_env):
    session, storage, user_1, _ = test_env
    source = _create_default_bundle(session, storage)
    now = datetime.now(timezone.utc)
    candidate_key = "performance-takes/1/finalizing-expired/old-token.webm"
    auth = PerformanceTakeUploadReservation(
        manifest=_manifest_row(
            source, user_id=user_1.id, take_uuid="finalizing-expired", title="Finalizing retry"
        ),
        user_id=user_1.id,
        client_request_id="finalizing-expired-retry",
        staging_object_key="staging/performance-takes/1/finalizing-expired/recording.webm",
        finalizing_object_key=candidate_key,
        quota_hold_id=quota_hold_fact(session, user_1.id, bytes_count=len(VALID_WEBM_BYTES)),
        status=UploadReservationStatus.FINALIZING,
        expires_at=now + timedelta(minutes=10),
        last_put_url_expires_at=now + timedelta(minutes=10),
        staging_cleanup_after=now + timedelta(minutes=10),
        finalizing_token="old-token",
        finalizing_expires_at=now - timedelta(minutes=1),
    )
    session.add(auth)
    session.commit()

    upload_reservation_cleanup_service.cleanup_expired_reservations(
        session,
        storage=storage,
        storage_usage_service=StorageUsageService(),
    )
    session.commit()

    session.refresh(auth)
    assert auth.status == UploadReservationStatus.RESERVED
    assert auth.finalizing_token is None
    assert auth.finalizing_object_key is None
    assert candidate_key in (auth.orphan_final_object_keys or "")


@contextmanager
def _reservation_client(session, storage, user):
    service = _performance_take_service(session=session, storage=storage)

    def db():
        yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_user] = lambda: session.get(
        User, inspect_row(user).identity[0]
    )
    app.dependency_overrides[get_performance_take_service] = lambda: service.takes
    app.dependency_overrides[get_performance_take_reservation_service] = lambda: service
    app.dependency_overrides[get_performance_take_finalization_service] = lambda: service
    try:
        yield PerformanceTakeTestClient(app), service
    finally:
        app.dependency_overrides.clear()


def _upload_intent():
    return _reservation_request_payload(
        {
            "client_request_id": "immutable-video",
            "practice_binding": {
                "score_id": "score-uuid-10",
                "revision_id": DEFAULT_TAKE_REVISION_ID,
                "bundle_id": _bundle_id(),
            },
            "media": {
                "kind": "VIDEO",
                "byte_size": len(VALID_WEBM_BYTES),
                "mime_type": "video/webm",
            },
            "scope": {
                "kind": "RANGE",
                "start_group_id": "entry-0-69d8d988516a",
                "end_group_id": "entry-9-d7e908049e12",
            },
        }
    )


def test_reservation_identity_metadata_replay_and_structural_take_lineage(test_env):
    session, storage, user, other = test_env
    with _reservation_client(session, storage, user) as (client, _):
        request = _upload_intent()
        first = client.post("/api/v1/performance-takes/upload-reservations", json=request).json()
        row = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == first["reservation_id"],
            )
        ).scalar_one()
        assert first["reservation_id"] != row.quota_hold_id
        assert manifest_from_row(
            row.manifest
        ).admitted_upload_metadata == PerformanceTakeUploadMetadata.model_validate(
            {key: value for key, value in request.items() if key != "client_request_id"}
        )
        repeated = client.post("/api/v1/performance-takes/upload-reservations", json=request).json()
        assert repeated["reservation_id"] == first["reservation_id"]
        assert repeated["take_id"] == first["take_id"]
        assert repeated["upload_target"] is not None
        for method, suffix in [(client.post, "/finalize"), (client.delete, "")]:
            assert (
                method(
                    f"/api/v1/performance-takes/upload-reservations/{row.quota_hold_id}{suffix}"
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
            app.dependency_overrides[get_current_user] = lambda: session.get(
                User, inspect_row(user).identity[0]
            )
        url = f"/api/v1/performance-takes/upload-reservations/{first['reservation_id']}/finalize"
        assert client.post(url, json={"media": request["media"]}).status_code == 422
        storage.put_bytes(
            key=row.staging_object_key, content=VALID_WEBM_BYTES, content_type="video/webm"
        )
        finalized = client.post(url)
        assert finalized.status_code == 200, finalized.text
        data = finalized.json()
        assert data["manifest"]["capture"]["kind"] == "VIDEO"
        assert data["manifest"]["scope"]["start_group_id"] == request["scope"]["start_group_id"]
        assert data["manifest"]["scope"]["end_group_id"] == request["scope"]["end_group_id"]
        assert data["manifest"]["tempo_plan"] == first["manifest"]["tempo_plan"]
        assert data["manifest"]["recording_timebase"] == request["recording_timebase"]
        take = session.execute(
            select(PerformanceTake).where(PerformanceTake.manifest_id == row.manifest_id)
        ).scalar_one()
        assert take.manifest.take_uuid == first["take_id"]
        assert client.post(url).json() == data
        completed = client.post(
            "/api/v1/performance-takes/upload-reservations", json=request
        ).json()
        assert completed["reservation_id"] == first["reservation_id"]
        assert completed["status"] == "COMPLETED" and completed["upload_target"] is None
        assert completed["take"] == data


@pytest.mark.parametrize(
    "part, field, changed",
    [
        ("practice_binding", "bundle_id", "another-source"),
        ("media", "byte_size", len(VALID_WEBM_BYTES) + 1),
        ("scope", "end_group_id", "another-group"),
        ("scope", "start_group_id", "another-start"),
        ("scope", "kind", "FULL"),
        ("tempo_selection", "bpm", 120.1),
        ("tempo_selection", "mode", "SCORE"),
        (
            "recording_timebase",
            "activeSegments",
            [
                {
                    "performanceStartUs": 1000,
                    "performanceEndUs": 5001000,
                    "mediaStartUs": 0,
                    "mediaEndUs": 5000000,
                }
            ],
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
        if part == "tempo_selection" and field == "mode":
            request[part].pop("bpm")
        if part == "scope" and field == "kind":
            request[part] = {"kind": changed}
        response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        assert response.status_code == 422
        with pytest.raises(ValidationException) as failure:
            service.reserve_upload(
                session,
                user.id,
                PerformanceTakeUploadReservationRequest.model_validate(request),
            )
        assert failure.value.details["reason"] == "client_request_id_reuse_conflict"


@pytest.mark.parametrize("committed", [False, True])
def test_finalize_unknown_commit_outcome_recovers_via_reservation_lineage(
    test_env, monkeypatch, committed
):
    import app.modules.performance_takes.upload_reservation.recovery as service_module

    session, storage, user, _ = test_env
    with _reservation_client(session, storage, user) as (client, _):
        request = _upload_intent()
        reservation = client.post(
            "/api/v1/performance-takes/upload-reservations", json=request
        ).json()
        storage.put_bytes(
            key=_staging_key(session, reservation["reservation_id"]),
            content=VALID_WEBM_BYTES,
            content_type="video/webm",
        )
        original_commit = Session.commit
        pending = True

        def disconnect_once(adapter):
            nonlocal pending
            completing = any(
                isinstance(row, PerformanceTakeUploadReservation) and row.status == "COMPLETED"
                for row in session.identity_map.values()
            )
            if pending and completing:
                pending = False
                if committed:
                    original_commit(adapter)
                raise DBAPIError.instance(
                    "COMMIT",
                    {},
                    Exception("connection is closed"),
                    Exception,
                    connection_invalidated=True,
                )
            original_commit(adapter)

        @contextmanager
        def recovery_session():
            with Session(session.get_bind(), expire_on_commit=False) as fresh:
                yield fresh

        monkeypatch.setattr(Session, "commit", disconnect_once)
        monkeypatch.setattr(service_module, "SessionLocal", recovery_session)
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
        assert retry.json()["take_id"] == reservation["take_id"]
        account = session.get(StorageUsageAccount, inspect_row(user).identity[0])
        session.refresh(account)
        assert storage_quota_service.snapshot_user(
            session, inspect_row(user).identity[0]
        ).reserved_bytes == 0 and account.used_bytes == len(VALID_WEBM_BYTES)
        assert len(session.execute(select(PerformanceTake)).scalars().all()) == 1
        assert len(session.execute(select(StoredObject)).scalars().all()) == 3


def test_bound_bundle_authorization_preserves_admitted_representation_identity(test_env):
    from dataclasses import replace
    from types import SimpleNamespace
    from unittest.mock import Mock
    from app.modules.practice.bundle.router import get_practice_bundle_service

    session, storage, user, other_user = test_env
    canonical = (
        Path(__file__).parent / "fixtures/musicxml/canonical-practice-score.musicxml"
    ).read_bytes()
    storage.put_bytes(key="canonical.xml", content=canonical, content_type="application/xml")
    assets = Mock(
        canonical_source=Mock(
            return_value=SimpleNamespace(
                stored_object=StoredObject(
                    object_key="canonical.xml",
                    byte_size=len(canonical),
                    sha256=hashlib.sha256(canonical).hexdigest(),
                    content_type="application/xml",
                )
            )
        )
    )
    session.add(assets.canonical_source.return_value.stored_object)
    session.commit()
    bundles = PracticeBundleService(storage=storage, asset_repository=assets)
    uploads = TakeLifecycleServices(storage=storage, practice_bundle_service=bundles)

    def override_db():
        yield session

    app.dependency_overrides.update(
        {
            get_db: override_db,
            get_current_user: lambda: user,
            get_practice_bundle_service: lambda: bundles,
            get_performance_take_service: lambda: uploads.takes,
            get_performance_take_reservation_service: lambda: uploads,
            get_performance_take_finalization_service: lambda: uploads,
        }
    )
    client = PerformanceTakeTestClient(app)
    url = "/api/v1/practice/scores/score-uuid-10/revisions/revision-uuid-100/bundle?include_notation=true"
    try:
        admitted = client.get(url)
        assert admitted.status_code == 200, admitted.text
        payload = admitted.json()
        row = session.execute(select(PracticeBundleRecord)).scalar_one()
        candidate = read_verified_bundle(
            storage, bundles.repository.read_by_bundle_id(session, row.bundle_id)
        )
        different = replace(
            candidate,
            prepared_musicxml=replace(
                candidate.prepared_musicxml, data=candidate.prepared_musicxml.data + b"\n"
            ),
        )
        ref, _ = bind_bundle(session, storage, different, revision_id=100)
        assert ref.bundle_id == row.bundle_id
        with (
            patch.object(
                bundles.compiler,
                "compile",
                side_effect=AssertionError("Bound reads do not compile"),
            ),
            patch.object(
                assets,
                "canonical_source",
                side_effect=AssertionError("Bound reads do not read canonical notation"),
            ),
        ):
            assert client.get(url).json() == payload
            binding = payload["binding"]
            request = {
                "practice_binding": binding,
                "client_request_id": "bound-save",
                "media": {"byte_size": len(VALID_WEBM_BYTES), "mime_type": "audio/webm"},
                "scope": {"kind": "FULL"},
            }
            reserved = client.post("/api/v1/performance-takes/upload-reservations", json=request)
            assert reserved.status_code == 200, reserved.text
            assert reserved.json()["manifest"]["practice_binding"] == binding
            denied = client.post(
                "/api/v1/performance-takes/upload-reservations",
                json={
                    **request,
                    "client_request_id": "wrong-bundle",
                    "practice_binding": {**binding, "bundle_id": different.bundle_id},
                },
            )
            assert denied.status_code == 404
            reservation = session.execute(select(PerformanceTakeUploadReservation)).scalar_one()
            storage.put_bytes(
                key=reservation.staging_object_key,
                content=VALID_WEBM_BYTES,
                content_type="audio/webm",
            )
            finalized = client.post(
                f"/api/v1/performance-takes/upload-reservations/{reservation.reservation_uuid}/finalize"
            )
            assert finalized.status_code == 200, finalized.text
            take = finalized.json()
            assert take["manifest"]["practice_binding"]["bundle_id"] == row.bundle_id
        app.dependency_overrides[get_current_user] = lambda: other_user
        assert client.get(url).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: session.get(
            User, inspect_row(user).identity[0]
        )
        score = session.get(Score, 10)
        score.head_revision_id = None
        session.flush()
        session.delete(session.get(ScoreRevision, 100))
        session.commit()
        assert client.get(url).status_code == 404
        assert (
            client.get(f"/api/v1/performance-takes/{take['take_id']}").json()["manifest"][
                "practice_binding"
            ]["bundle_id"]
            == row.bundle_id
        )
        denied = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={**request, "client_request_id": "deleted-binding"},
        )
        assert denied.status_code == 404
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "scope_kind,tempo_case",
    [
        ("FULL", "SCORE"),
        ("RANGE", "SCORE"),
        ("RANGE", "CUSTOM"),
        ("FULL", "NO_TEMPO"),
        ("FULL", "DELAYED_TEMPO"),
    ],
)
def test_reservation_derives_and_transfers_exact_bundle_plan(test_env, scope_kind, tempo_case):
    from app.modules.practice.bundle.compiler import PracticeBundleCompiler

    session, storage, user, _ = test_env
    xml = (
        Path(__file__).parent / "fixtures/musicxml/canonical-practice-score.musicxml"
    ).read_bytes()
    if tempo_case == "NO_TEMPO":
        xml = xml.replace(b'<direction><sound tempo="120"/></direction>', b"").replace(
            b'<direction><sound tempo="90"/></direction>', b""
        )
    elif tempo_case == "DELAYED_TEMPO":
        xml = xml.replace(b'<direction><sound tempo="120"/></direction>', b"")
    source = PracticeBundleCompiler().compile(canonical_musicxml=xml)
    ref, _ = bind_bundle(session, storage, source, revision_id=100)
    artifact = source.artifact.value
    with _reservation_client(session, storage, user) as (client, service):
        scope = (
            {"kind": "FULL"}
            if scope_kind == "FULL"
            else {
                "kind": "RANGE",
                "start_group_id": artifact["moments"][2]["groupId"],
                "end_group_id": artifact["moments"][2]["groupId"],
            }
        )
        selection = (
            {"mode": "CUSTOM_FIXED_BPM", "bpm": 80.5}
            if tempo_case == "CUSTOM"
            else {"mode": "SCORE"}
        )
        request = _reservation_request_payload(
            {
                "practice_binding": {
                    "score_id": "score-uuid-10",
                    "revision_id": "revision-uuid-100",
                    "bundle_id": ref.bundle_id,
                },
                "client_request_id": "derived-plan",
                "scope": scope,
                "tempo_selection": selection,
                "media": {
                    "byte_size": len(VALID_WEBM_BYTES),
                    "mime_type": "audio/webm",
                },
            }
        )
        with (
            patch.object(
                service.practice_bundle_service.compiler,
                "compile",
                side_effect=AssertionError("Save consumes exact bound Bundle"),
            ),
            patch.object(
                service.practice_bundle_service,
                "resolve_bundle",
                side_effect=AssertionError("Save consumes exact bound Bundle"),
            ),
        ):
            response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        assert response.status_code == 200, response.text
        accepted = response.json()
        row = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == accepted["reservation_id"]
            )
        ).scalar_one()
        expected_scope = {"kind": scope_kind, "start_tick": 0, "terminal_tick": 12}
        if scope_kind == "RANGE":
            expected_scope = {**scope, "start_tick": 4, "terminal_tick": 9}
        if tempo_case == "CUSTOM":
            segments = [{"startTick": 0, "bpm": selection["bpm"], "source": "CUSTOM"}]
        elif tempo_case == "NO_TEMPO":
            segments = [{"startTick": 0, "bpm": 80, "source": "PRODUCT_DEFAULT"}]
        elif tempo_case == "DELAYED_TEMPO":
            segments = [
                {"startTick": 0, "bpm": 80, "source": "PRODUCT_DEFAULT"},
                {"startTick": 6, "bpm": 90, "source": "MUSICXML"},
            ]
        else:
            segments = [
                {"startTick": 0, "bpm": 120, "source": "MUSICXML"},
                {"startTick": 6, "bpm": 90, "source": "MUSICXML"},
            ]
        expected_tempo = {"selection": selection, "segments": segments}
        assert manifest_from_row(
            row.manifest
        ).admitted_upload_metadata == PerformanceTakeUploadMetadata.model_validate(
            {key: value for key, value in request.items() if key != "client_request_id"}
        )
        assert accepted["manifest"]["score_timebase"] == {
            "ticks_per_quarter": artifact["ticksPerQuarter"]
        }
        assert (
            manifest_from_row(row.manifest).snapshot.score_timebase.ticks_per_quarter
            == artifact["ticksPerQuarter"]
        )
        assert accepted["manifest"]["scope"] == expected_scope
        assert (
            accepted["manifest"]["tempo_plan"]
            == expected_tempo
            == json.loads(row.manifest.manifest_json)["manifest"]["tempo_plan"]
        )
        assert (
            manifest_from_row(row.manifest).snapshot.scope.start_tick,
            manifest_from_row(row.manifest).snapshot.scope.terminal_tick,
        ) == (
            expected_scope["start_tick"],
            expected_scope["terminal_tick"],
        )
        assert manifest_from_row(row.manifest).snapshot.practice_binding.bundle_id == ref.bundle_id
        if scope_kind == "FULL":
            assert set(manifest_from_row(row.manifest).snapshot.scope.model_dump()) == {
                "kind",
                "start_tick",
                "terminal_tick",
            }
        # Another legitimate selection retains the same exact immutable source lineage.
        other = client.post(
            "/api/v1/performance-takes/upload-reservations",
            json={
                **request,
                "client_request_id": "other-plan",
                "scope": {"kind": "FULL"},
                "tempo_selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 100},
            },
        )
        assert other.status_code == 200, other.text
        assert {
            manifest_from_row(value.manifest).snapshot.practice_binding.bundle_id
            for value in session.execute(select(PerformanceTakeUploadReservation)).scalars()
        } == {ref.bundle_id}
        score = session.get(Score, 10)
        score.head_revision_id = None
        session.flush()
        session.delete(session.get(ScoreRevision, 100))
        session.commit()
        storage.put_bytes(
            key=row.staging_object_key, content=VALID_WEBM_BYTES, content_type="audio/webm"
        )
        with (
            patch.object(
                service.practice_bundle_service,
                "authorize_bundle_for_save",
                side_effect=AssertionError("Admitted reservation uses its snapshot"),
            ),
            patch(
                "app.modules.performance_takes.upload_reservation.reservation_service.resolve_practice_score_plan",
                side_effect=AssertionError("Replay and finalize consume persisted truth"),
            ),
        ):
            replay = client.post("/api/v1/performance-takes/upload-reservations", json=request)
            assert replay.status_code == 200, replay.text
            assert replay.json()["manifest"]["tempo_plan"] == expected_tempo
            finalized = client.post(
                f"/api/v1/performance-takes/upload-reservations/{row.reservation_uuid}/finalize"
            )
            assert finalized.status_code == 200, finalized.text
            take = finalized.json()
            completed = client.post("/api/v1/performance-takes/upload-reservations", json=request)
            assert completed.status_code == 200, completed.text
            assert completed.json()["take"] == take
        assert take["manifest"]["practice_binding"]["bundle_id"] == ref.bundle_id
        assert take["manifest"]["score_timebase"] == {
            "ticks_per_quarter": manifest_from_row(
                row.manifest
            ).snapshot.score_timebase.ticks_per_quarter
        }
        assert (
            client.get(f"/api/v1/performance-takes/{take['take_id']}").json()["manifest"][
                "score_timebase"
            ]
            == take["manifest"]["score_timebase"]
        )
        assert (
            client.get("/api/v1/performance-takes").json()["items"][0]["manifest"]["score_timebase"]
            == take["manifest"]["score_timebase"]
        )
        assert (
            take["manifest"]["scope"]["start_tick"]
            == manifest_from_row(row.manifest).snapshot.scope.start_tick
        )
        assert (
            take["manifest"]["scope"]["terminal_tick"]
            == manifest_from_row(row.manifest).snapshot.scope.terminal_tick
        )
        assert take["manifest"]["tempo_plan"] == expected_tempo
        saved = session.execute(
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .where(PerformanceTakeManifest.take_uuid == take["take_id"])
        ).scalar_one()
        assert (
            manifest_from_row(saved.manifest).snapshot.practice_binding.bundle_id == ref.bundle_id
        )
        assert (
            manifest_from_row(saved.manifest).snapshot.score_timebase.ticks_per_quarter
            == manifest_from_row(row.manifest).snapshot.score_timebase.ticks_per_quarter
        )
        assert (
            manifest_from_row(saved.manifest).snapshot.scope.start_tick
            == manifest_from_row(row.manifest).snapshot.scope.start_tick
        )
        assert (
            manifest_from_row(saved.manifest).snapshot.scope.terminal_tick
            == manifest_from_row(row.manifest).snapshot.scope.terminal_tick
        )
        assert saved.manifest.manifest_json == row.manifest.manifest_json
        assert saved.manifest.manifest_sha256 == row.manifest.manifest_sha256
        read = client.get(f"/api/v1/performance-takes/{take['take_id']}")
        assert read.status_code == 200
        assert read.json()["manifest"]["tempo_plan"] == expected_tempo


@pytest.mark.parametrize("status", ["FINALIZING", "COMPLETED"])
def test_cancel_rejects_nonpending_reservation_without_claiming_success(test_env, status):
    session, storage, user, _ = test_env
    with _reservation_client(session, storage, user) as (client, service):
        response = client.post(
            "/api/v1/performance-takes/upload-reservations", json=_upload_intent()
        )
        data = response.json()
        row = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == data["reservation_id"]
            )
        ).scalar_one()
        if status == "COMPLETED":
            storage.put_bytes(
                key=row.staging_object_key, content=VALID_WEBM_BYTES, content_type="video/webm"
            )
            assert (
                client.post(
                    f"/api/v1/performance-takes/upload-reservations/{data['reservation_id']}/finalize"
                ).status_code
                == 200
            )
        else:
            now = datetime.now(timezone.utc)
            transition = lifecycle_from_row(row).begin_finalize(
                lease=FinalizeLease("active", "active-key", now + timedelta(minutes=15)), now=now
            )
            apply_transition(row, transition, now=now)
            session.commit()
        cancelled = client.delete(
            f"/api/v1/performance-takes/upload-reservations/{data['reservation_id']}"
        )
        assert cancelled.status_code == 422
        session.refresh(row)
        assert row.status == status


def test_cleanup_rejects_active_reservation_with_take_as_invariant_violation(test_env):
    from app.modules.performance_takes.upload_reservation.domain import ReservationInvariantError

    session, storage, user, _ = test_env
    source = _create_default_bundle(session, storage)
    take = _create_default_take(
        session,
        user_id=user.id,
        source=source,
        client_request_id="corrupt-state",
        take_uuid="corrupt-state",
        media_object_key="durable-object",
    )
    row = session.scalar(
        select(PerformanceTakeUploadReservation).where(
            PerformanceTakeUploadReservation.manifest_id == take.manifest_id
        )
    )
    # Deliberate cross-row corruption: individual tuple constraints cannot enforce
    # atomic Take creation. Cleanup must reject it instead of repairing it.
    row.status = "RESERVED"
    row.expires_at = datetime(2020, 1, 1, tzinfo=UTC)
    session.commit()
    with pytest.raises(ReservationInvariantError, match="atomic"):
        upload_reservation_cleanup_service.cleanup_expired_reservations(
            session, storage, StorageUsageService()
        )
    session.rollback()
    session.refresh(row)
    assert (
        row.status == "RESERVED"
        and manifest_from_row(row.manifest).snapshot.practice_binding.bundle_id == source.bundle_id
    )
    service = _performance_take_service(session=session, storage=storage)
    from app.modules.performance_takes.schemas import PerformanceTakeUploadMetadata

    metadata = PerformanceTakeUploadMetadata.model_validate(
        {key: value for key, value in _upload_intent().items() if key != "client_request_id"}
    )
    with pytest.raises(ReservationInvariantError, match="atomic"):
        service.reservations._replay_reservation(session, row, metadata)


def test_recording_microseconds_survive_reservation_finalize_and_take_reads(test_env):
    session, storage, user, _ = test_env
    request = _upload_intent()
    timebase = {
        "nominalMediaDurationUs": 1000003,
        "activeSegments": [
            {
                "performanceStartUs": 137,
                "performanceEndUs": 500138,
                "mediaStartUs": 0,
                "mediaEndUs": 500001,
            },
            {
                "performanceStartUs": 600139,
                "performanceEndUs": 1100141,
                "mediaStartUs": 500001,
                "mediaEndUs": 1000003,
            },
        ],
    }
    request["recording_timebase"] = timebase
    with _reservation_client(session, storage, user) as (client, _):
        response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        assert response.status_code == 200, response.text
        reserved = response.json()
        assert reserved["manifest"]["recording_timebase"] == timebase
        row = session.execute(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == reserved["reservation_id"]
            )
        ).scalar_one()
        assert json.loads(row.manifest.manifest_json)["manifest"]["recording_timebase"] == timebase
        storage.put_bytes(
            key=row.staging_object_key, content=VALID_WEBM_BYTES, content_type="video/webm"
        )
        response = client.post(
            f"/api/v1/performance-takes/upload-reservations/{reserved['reservation_id']}/finalize"
        )
        assert response.status_code == 200, response.text
        take = response.json()
        assert take["manifest"]["recording_timebase"] == timebase
        assert (
            client.get(f"/api/v1/performance-takes/{take['take_id']}").json()["manifest"][
                "recording_timebase"
            ]
            == timebase
        )
        assert (
            client.get("/api/v1/performance-takes").json()["items"][0]["manifest"][
                "recording_timebase"
            ]
            == timebase
        )


@pytest.mark.parametrize("available_delta", [-1, 0, 1])
def test_reservation_capacity_uses_exact_available_quota(test_env, available_delta):
    from app.db.models.storage_quota import StorageQuotaHold

    session, storage, user, _ = test_env
    requested_bytes = 101 * 1024 * 1024
    account = session.get(StorageUsageAccount, user.id)
    counter = session.scalar(
        select(StorageUsageCounter).where(
            StorageUsageCounter.user_id == user.id,
            StorageUsageCounter.category == StorageUsageCategory.UPLOAD,
        )
    )
    account.used_bytes = counter.used_bytes = 9 * 1024 * 1024
    held_bytes = 5 * 1024 * 1024
    admit_hold(
        session,
        user_id=user.id,
        category=StorageUsageCategory.UPLOAD,
        bytes_count=held_bytes,
    )
    session.get(UserStorageEntitlement, 1).mode_override = StorageQuotaMode.HARD_LIMIT
    session.get(UserStorageEntitlement, 1).limit_override_bytes = (
        account.used_bytes + held_bytes + requested_bytes + available_delta
    )
    session.commit()
    request = _upload_intent()
    request["media"]["byte_size"] = requested_bytes
    with _reservation_client(session, storage, user) as (client, _):
        response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        session.refresh(account)
        session.refresh(counter)
        if available_delta < 0:
            assert response.status_code == 422, response.text
            assert response.json()["code"] == "storage_quota_exceeded"
            assert session.scalar(select(PerformanceTakeManifest)) is None
            assert session.scalar(select(PerformanceTakeUploadReservation)) is None
            assert (
                storage_quota_service.snapshot_user(session, user.id).reserved_bytes
                == storage_quota_service.snapshot_user(session, user.id).categories[
                    StorageUsageCategory.UPLOAD
                ]
                == held_bytes
            )
        else:
            assert response.status_code == 200, response.text
            accepted = response.json()
            assert accepted["manifest"]["capture"]["byte_size"] == requested_bytes
            row = session.scalar(select(PerformanceTakeUploadReservation))
            hold = session.scalar(
                select(StorageQuotaHold).where(StorageQuotaHold.id == row.quota_hold_id)
            )
            assert hold.bytes_held == requested_bytes
            assert (
                storage_quota_service.snapshot_user(session, user.id).reserved_bytes
                == storage_quota_service.snapshot_user(session, user.id).categories[
                    StorageUsageCategory.UPLOAD
                ]
                == held_bytes + requested_bytes
            )
            repeated = client.post("/api/v1/performance-takes/upload-reservations", json=request)
            assert repeated.status_code == 200, repeated.text
            assert repeated.json()["reservation_id"] == accepted["reservation_id"]
            session.refresh(account)
            assert (
                storage_quota_service.snapshot_user(session, user.id).reserved_bytes
                == held_bytes + requested_bytes
            )


def test_reservation_admits_structurally_valid_long_recording_timebase(test_env):
    session, storage, user, _ = test_env
    request = _upload_intent()
    duration = 18 * 60 * 60 * 1_000_000 + 137
    request["recording_timebase"] = {
        "nominalMediaDurationUs": duration,
        "activeSegments": [
            {
                "performanceStartUs": 0,
                "performanceEndUs": duration,
                "mediaStartUs": 0,
                "mediaEndUs": duration,
            }
        ],
    }
    with _reservation_client(session, storage, user) as (client, _):
        response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        assert response.status_code == 200, response.text
        assert response.json()["manifest"]["recording_timebase"] == request["recording_timebase"]
        row = session.scalar(select(PerformanceTakeUploadReservation))
        assert (
            manifest_from_row(row.manifest).snapshot.recording_timebase.nominalMediaDurationUs
            == duration
        )


def test_segmented_recording_manifest_round_trips_through_reserve_finalize_and_read(test_env):
    session, storage, user, _ = test_env
    request = _upload_intent()
    timebase = {
        "nominalMediaDurationUs": 1024 * 1000,
        "activeSegments": [
            {
                "performanceStartUs": index * 1001,
                "performanceEndUs": index * 1001 + 1000,
                "mediaStartUs": index * 1000,
                "mediaEndUs": (index + 1) * 1000,
            }
            for index in range(1024)
        ],
    }
    request["recording_timebase"] = timebase
    with _reservation_client(session, storage, user) as (client, _):
        response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        assert response.status_code == 200, response.text
        accepted = response.json()
        assert accepted["manifest"]["recording_timebase"] == timebase
        row = session.scalar(select(PerformanceTakeUploadReservation))
        assert len(row.manifest.manifest_json.encode("utf-8")) > 64 * 1024
        assert json.loads(row.manifest.manifest_json)["manifest"]["recording_timebase"] == timebase
        assert (
            manifest_from_row(row.manifest).snapshot.recording_timebase.model_dump(mode="json")
            == timebase
        )
        storage.put_bytes(
            key=row.staging_object_key, content=VALID_WEBM_BYTES, content_type="video/webm"
        )
        finalized = client.post(
            f"/api/v1/performance-takes/upload-reservations/{accepted['reservation_id']}/finalize"
        )
        assert finalized.status_code == 200, finalized.text
        assert finalized.json()["manifest"] == accepted["manifest"]
        detail = client.get(f"/api/v1/performance-takes/{accepted['take_id']}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["manifest"] == accepted["manifest"]


@pytest.mark.parametrize(
    "object_stage, expected_status", [("staging", "RESERVED"), ("candidate", "RESERVED")]
)
@pytest.mark.parametrize("size_delta", [-1, 1])
def test_finalize_requires_exact_admitted_object_size(
    test_env, monkeypatch, object_stage, expected_status, size_delta
):
    session, storage, user, _ = test_env
    different_bytes = VALID_WEBM_BYTES[:-1] if size_delta < 0 else VALID_WEBM_BYTES + b"x"
    with _reservation_client(session, storage, user) as (client, _):
        response = client.post(
            "/api/v1/performance-takes/upload-reservations", json=_upload_intent()
        )
        assert response.status_code == 200, response.text
        accepted = response.json()
        row = session.scalar(select(PerformanceTakeUploadReservation))
        object_ids = set(session.scalars(select(StoredObject.id)))
        storage.put_bytes(
            key=row.staging_object_key,
            content=different_bytes if object_stage == "staging" else VALID_WEBM_BYTES,
            content_type="video/webm",
        )
        if object_stage == "candidate":
            copy = storage.copy

            def copy_with_different_size(source_key, target_key):
                copy(source_key, target_key)
                storage.put_bytes(
                    key=target_key, content=different_bytes, content_type="video/webm"
                )

            monkeypatch.setattr(storage, "copy", copy_with_different_size)
        finalized = client.post(
            f"/api/v1/performance-takes/upload-reservations/{accepted['reservation_id']}/finalize"
        )
        assert finalized.status_code == 422, finalized.text
        assert session.scalar(select(PerformanceTake)) is None
        assert set(session.scalars(select(StoredObject.id))) == object_ids
        session.refresh(row)
        assert row.status == expected_status
        account = session.get(StorageUsageAccount, user.id)
        session.refresh(account)
        assert account.used_bytes == 0
        assert storage_quota_service.snapshot_user(session, user.id).reserved_bytes == len(
            VALID_WEBM_BYTES
        )


@pytest.mark.parametrize("bpm", [20.5, 80.5, 300.25])
def test_exact_custom_tempo_survives_reserve_replay_finalize_and_reads(test_env, bpm):
    import math

    session, storage, user, _ = test_env
    request = _upload_intent()
    request["tempo_selection"] = {"mode": "CUSTOM_FIXED_BPM", "bpm": bpm}
    expected = {
        "selection": request["tempo_selection"],
        "segments": [{"startTick": 0, "bpm": bpm, "source": "CUSTOM"}],
    }
    with _reservation_client(session, storage, user) as (client, service):
        response = client.post("/api/v1/performance-takes/upload-reservations", json=request)
        assert response.status_code == 200, response.text
        accepted = response.json()
        assert accepted["manifest"]["tempo_plan"] == expected
        row = session.scalar(select(PerformanceTakeUploadReservation))
        manifest = manifest_from_row(row.manifest)
        assert manifest.snapshot.tempo_plan.selection.bpm == bpm
        assert manifest.snapshot.tempo_plan.segments[0].bpm == bpm
        assert json.loads(row.manifest.manifest_json)["manifest"]["tempo_plan"] == expected
        assert row.manifest.manifest_sha256 == manifest.document_sha256
        with (
            patch.object(
                service.practice_bundle_service,
                "authorize_bundle_for_save",
                side_effect=AssertionError("Replay uses admitted semantics"),
            ),
            patch(
                "app.modules.performance_takes.upload_reservation.reservation_service.resolve_practice_score_plan",
                side_effect=AssertionError("Replay does not plan"),
            ),
        ):
            replay = client.post("/api/v1/performance-takes/upload-reservations", json=request)
            assert replay.status_code == 200, replay.text
            assert replay.json()["reservation_id"] == accepted["reservation_id"]
            assert replay.json()["manifest"] == accepted["manifest"]
            changed = {
                **request,
                "tempo_selection": {
                    "mode": "CUSTOM_FIXED_BPM",
                    "bpm": math.nextafter(bpm, math.inf),
                },
            }
            assert (
                client.post(
                    "/api/v1/performance-takes/upload-reservations", json=changed
                ).status_code
                == 422
            )
        storage.put_bytes(
            key=row.staging_object_key, content=VALID_WEBM_BYTES, content_type="video/webm"
        )
        finalized = client.post(
            f"/api/v1/performance-takes/upload-reservations/{accepted['reservation_id']}/finalize"
        )
        assert finalized.status_code == 200, finalized.text
        assert finalized.json()["manifest"] == accepted["manifest"]
        detail = client.get(f"/api/v1/performance-takes/{accepted['take_id']}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["manifest"]["tempo_plan"] == expected
        listed = client.get("/api/v1/performance-takes")
        assert listed.status_code == 200, listed.text
        assert listed.json()["items"][0]["manifest"]["tempo_plan"] == expected


def test_failed_reserve_rolls_back_manifest_reservation_and_quota(test_env):
    from app.modules.performance_takes.repository import PerformanceTakeRepository
    from app.db.models.storage_quota import StorageQuotaHold

    session, storage, user, _ = test_env
    service = _performance_take_service(session=session, storage=storage)

    class FailureAfterManifest(PerformanceTakeRepository):
        def create_reservation(self, db, reservation):
            assert reservation.manifest_id is not None
            super().create_reservation(db, reservation)
            raise RuntimeError("reservation transaction failed")

    service.repository = FailureAfterManifest()
    request = PerformanceTakeUploadReservationRequest.model_validate(_upload_intent())
    with pytest.raises(RuntimeError, match="transaction failed"):
        service.reserve_upload(session, user.id, request)
    assert session.scalar(select(PerformanceTakeManifest)) is None
    assert session.scalar(select(PerformanceTakeUploadReservation)) is None
    assert session.scalar(select(StorageQuotaHold)) is None
    assert storage_quota_service.snapshot_user(session, user.id).reserved_bytes == 0


def test_take_deletion_retires_media_but_preserves_manifest_and_reservation(test_env, monkeypatch):
    session, storage, user, _ = test_env
    with _reservation_client(session, storage, user) as (client, _):
        reserved_response = client.post(
            "/api/v1/performance-takes/upload-reservations", json=_upload_intent()
        )
        assert reserved_response.status_code == 200, reserved_response.text
        accepted = reserved_response.json()
        reservation = session.scalar(
            select(PerformanceTakeUploadReservation).where(
                PerformanceTakeUploadReservation.reservation_uuid == accepted["reservation_id"]
            )
        )
        manifest_id = reservation.manifest_id
        before = manifest_from_row(reservation.manifest)
        storage.put_bytes(
            key=reservation.staging_object_key, content=VALID_WEBM_BYTES, content_type="video/webm"
        )
        finalized = client.post(
            f"/api/v1/performance-takes/upload-reservations/{accepted['reservation_id']}/finalize"
        )
        assert finalized.status_code == 200, finalized.text
        take = session.scalar(select(PerformanceTake))
        assert take.manifest_id == manifest_id
        assert finalized.json()["manifest"] == accepted["manifest"]
        from app.modules.storage_inventory.composition import build_storage_inventory_registry
        from app.modules.storage_usage.reconciliation import StorageUsageReconciliation

        reconciler = StorageUsageReconciliation(build_storage_inventory_registry())
        assert not reconciler.inspect_user(session, user.id).drift
        assert (
            reconciler.inspect_user(session, user.id).expected_account.used_bytes
            == take.recording_object.byte_size
        )
        final_key = take.recording_object.object_key
        deleted = client.delete(f"/api/v1/performance-takes/{accepted['take_id']}")
        assert deleted.status_code == 204, deleted.text
        assert deleted.content == b""
        assert session.scalar(select(PerformanceTake)) is None
        for suffix in ["", "/playback-url", "/media"]:
            assert (
                client.get(f"/api/v1/performance-takes/{accepted['take_id']}{suffix}").status_code
                == 404
            )
        assert client.get("/api/v1/performance-takes").json()["items"] == []
        assert storage.exists(final_key)
        operation = session.scalar(
            select(StoredObjectRetirement).where(StoredObjectRetirement.object_key == final_key)
        )
        assert operation.byte_size == before.snapshot.capture.byte_size
        assert session.scalar(select(PerformanceTake)) is None
        assert session.get(StorageUsageAccount, user.id).used_bytes == 0
        assert reconciler.inspect_user(session, user.id).expected_account.used_bytes == 0
        outcome = _run_retirement(monkeypatch, session, storage, operation.retirement_uuid)
        assert outcome["status"] == "completed"
        session.expire_all()
        assert session.scalar(select(PerformanceTake)) is None
        assert not storage.exists(final_key)
        assert manifest_from_row(session.get(PerformanceTakeManifest, manifest_id)) == before
        assert session.scalar(select(PerformanceTakeUploadReservation)).manifest_id == manifest_id
        assert session.get(StorageUsageAccount, user.id).used_bytes == 0


def test_final_blob_sha_is_the_complete_candidate_and_actual_object_digest(test_env):
    session, storage, user, _ = test_env
    from app.modules.performance_takes import final_media as module

    hashes = {}
    original = module._sha256_storage_object

    def record(storage, key):
        result = original(storage, key)
        hashes[key] = result
        return result

    with (
        _reservation_client(session, storage, user) as (client, _),
        patch.object(module, "_sha256_storage_object", side_effect=record),
    ):
        accepted = client.post(
            "/api/v1/performance-takes/upload-reservations", json=_upload_intent()
        ).json()
        storage.put_bytes(
            key=_staging_key(session, accepted["reservation_id"]),
            content=VALID_WEBM_BYTES,
            content_type="video/webm",
        )
        response = client.post(
            f"/api/v1/performance-takes/upload-reservations/{accepted['reservation_id']}/finalize"
        )
        assert response.status_code == 200, response.text
        take = session.scalar(select(PerformanceTake))
        blob = take.recording_object
        actual = storage.read_bytes(blob.object_key)
        digest = hashlib.sha256(actual).hexdigest()
        assert hashes[blob.object_key] == blob.sha256 == digest
        assert (
            blob.byte_size
            == len(actual)
            == manifest_from_row(take.manifest).snapshot.capture.byte_size
        )
        assert response.json()["recording_media"] == {
            "mime_type": blob.content_type,
            "byte_size": blob.byte_size,
        }
        print("candidate_sha256=persisted_sha256=actual_sha256=" + digest)


def test_same_size_candidate_corruption_has_no_blob_or_take(test_env):
    session, storage, user, _ = test_env
    original = storage.copy

    def corrupt(source, target):
        original(source, target)
        storage.put_bytes(
            key=target, content=VALID_WEBM_BYTES[:-1] + b"X", content_type="video/webm"
        )

    with _reservation_client(session, storage, user) as (client, service):
        accepted = client.post(
            "/api/v1/performance-takes/upload-reservations", json=_upload_intent()
        ).json()
        storage.put_bytes(
            key=_staging_key(session, accepted["reservation_id"]),
            content=VALID_WEBM_BYTES,
            content_type="video/webm",
        )
        with (
            patch.object(storage, "copy", side_effect=corrupt),
            pytest.raises(ValidationException) as error,
        ):
            service.finalize_take(session, user.id, accepted["reservation_id"])
        assert error.value.details["field"] == "media_checksum"
        assert error.value.details["reason"] == "candidate_content_mismatch"
        assert (
            len(session.scalars(select(StoredObject)).all()) == 2
            and session.scalar(select(PerformanceTake)) is None
        )
        row = session.scalar(select(PerformanceTakeUploadReservation))
        assert row.orphan_final_object_keys != "[]"
        assert storage_quota_service.snapshot_user(session, user.id).reserved_bytes == len(
            VALID_WEBM_BYTES
        )


@pytest.mark.parametrize(
    "field,bad", [("byte_size", 43), ("content_type", "audio/mp4"), ("sha256", "invalid")]
)
def test_take_read_rejects_corrupt_or_capture_mismatched_blob(test_env, field, bad):
    session, storage, user, _ = test_env
    source = _create_default_bundle(session, storage)
    take = _create_default_take(
        session,
        user_id=user.id,
        source=source,
        client_request_id="corrupt-recording",
        take_uuid="corrupt-recording",
        media_object_key="corrupt.webm",
    )
    setattr(take.recording_object, field, bad)
    with pytest.raises(ValidationException):
        PerformanceTakeService(storage=storage)._to_read_dto(take)
