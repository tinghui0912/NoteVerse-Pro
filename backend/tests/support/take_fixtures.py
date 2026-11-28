from __future__ import annotations


from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings

from tests.support.runtime_resources import resources_for


from tests.support.uploads import settled_upload_session
from tests.support.quota import quota_hold_fact
from app.modules.storage_governance.quota.states import StorageQuotaHoldStatus


from app.modules.performance_takes.upload_reservation.states import UploadReservationStatus

from datetime import datetime, timezone
import hashlib
import json
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from tests.support.browser import BrowserTestClient as TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

from app.db.models import (
    StoredObject,
    PerformanceTake,
    PerformanceTakeUploadReservation,
    PracticeBundleRecord,
    ScoreRevisionPracticeBinding,
    Score,
    ScoreRevision,
    StoragePlanPolicy,
    UserStorageEntitlement,
    StorageUsageAccount,
    StorageUsageCounter,
    User,
)
from app.modules.practice.bundle.states import PracticeBundleStatus
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.revisions.domain import RevisionOrigin
from tests.support.take_lifecycle import TakeLifecycleServices
from app.modules.performance_takes.manifest import TakeManifest
from app.modules.performance_takes.schemas import (
    PerformanceTakeManifestRead,
)
from app.modules.performance_takes.manifest_persistence import manifest_to_row
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.practice.bundle.domain import (
    PracticeBundle,
    PracticeBundleRepresentation,
    PracticeBundleArtifact,
)
from app.modules.practice.score.artifact import (
    canonical_practice_artifact_bytes,
    practice_artifact_id,
)
from app.modules.storage_governance.usage.service import StorageUsageService
from tests.support.object_storage import InMemoryObjectStorage
from app.modules.practice.bundle.retention import PracticeBundleRetention
from app.runtime.customer_api.context import get_context

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
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[3]))
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
        practice_bundle_service=PracticeBundleService(
            writes=resources_for(storage).build_object_write_coordinator(),
            retention=PracticeBundleRetention(
                config=StoredObjectRetirementSettings.model_validate(
                    get_context().settings.model_dump()
                )
            ),
        ),
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
        upload_session=settled_upload_session(user_id=user_id),
        quota_hold_id=quota_hold_fact(
            session,
            user_id,
            bytes_count=len(VALID_WEBM_BYTES),
            status=StorageQuotaHoldStatus.CONSUMED,
        ),
        expires_at=datetime.now(timezone.utc),
        status=UploadReservationStatus.COMPLETED,
    )
    session.add(reservation)
    session.flush()
    take = PerformanceTake(
        owner_user_id=user_id,
        media_status="READY",
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


def _session_object_key(session, reservation_id):
    from app.db.models import UploadSession

    return session.scalar(
        select(UploadSession.object_key)
        .join(
            PerformanceTakeUploadReservation,
            PerformanceTakeUploadReservation.upload_session_id == UploadSession.id,
        )
        .where(PerformanceTakeUploadReservation.reservation_uuid == reservation_id)
    )


@pytest.fixture
def test_env(
    postgres_engine, tmp_path
) -> Iterator[tuple[Session, InMemoryObjectStorage, User, User]]:
    engine = postgres_engine

    SQLModel.metadata.create_all(engine)
    storage = InMemoryObjectStorage()

    with Session(engine, expire_on_commit=False) as session:
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
