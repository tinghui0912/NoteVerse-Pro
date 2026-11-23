"""Lightweight personal completion admission, isolated from execution/results/media."""

import ast
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from itertools import product
from pathlib import Path
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import ValidationError
from fastapi.testclient import TestClient

from app.db.models import (
    PracticeActivity,
    User,
    Score,
    ScoreRevision,
    PracticeBundleRecord,
    ScoreRevisionPracticeBinding,
    StoredObject,
    ScoreMembership,
    Notification,
    RealtimeChange,
    StorageUsageEvent,
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    RevisionMetadataOutbox,
    ScoreLibraryOrganization,
)
from app.db.models.practice_activity import (
    PracticeActivityMode as Mode,
    PracticeActivityInputSource as Input,
    PracticeActivityScopeKind as Scope,
)
from app.db.models.practice_bundle import PracticeBundleStatus
from app.db.models.score import RevisionOrigin
from app.db.models.score_access import MembershipRole
from app.core.exceptions import AppException, ConflictException
from app.modules.practice.activities.schemas import (
    PracticeActivityCreateRequest,
    PracticeActivityRead,
)
from app.modules.practice.activities.service import PracticeActivityService
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


def payload(**changes):
    return {
        "client_session_id": "local-completion",
        "practice_binding": {"score_id": "score", "revision_id": "revision", "bundle_id": "bundle"},
        "mode": "STEP_BY_STEP",
        "input_source": "MIDI",
        "scope": {"kind": "FULL", "start_tick": 0, "terminal_tick": 480},
        **changes,
    }


def request(**changes):
    return PracticeActivityCreateRequest.model_validate(payload(**changes))


@pytest.fixture
def database(postgres_engine):
    with Session(postgres_engine) as db:
        db.add_all(
            [
                User(id=n, email=f"activity-{n}@example.test", password_hash="hash")
                for n in (1, 2, 3, 4)
            ]
        )
        db.flush()
        score = Score(score_uuid="score", owner_user_id=1, display_title="Practice")
        other = Score(score_uuid="other", owner_user_id=1, display_title="Other")
        db.add_all([score, other])
        db.flush()
        revision = ScoreRevision(
            revision_uuid="revision",
            score_id=score.id,
            revision_number=1,
            content_hash="a" * 64,
            origin=RevisionOrigin.EDIT,
        )
        foreign = ScoreRevision(
            revision_uuid="foreign",
            score_id=other.id,
            revision_number=1,
            content_hash="b" * 64,
            origin=RevisionOrigin.EDIT,
        )
        db.add_all([revision, foreign])
        db.flush()
        score.head_revision_id = revision.id
        bundle = PracticeBundleRecord(
            bundle_id="bundle",
            artifact_id="artifact",
            artifact_schema_version=1,
            status=PracticeBundleStatus.READY,
            prepared_musicxml_object=StoredObject(
                object_key="opaque/xml",
                byte_size=10,
                sha256="c" * 64,
                content_type="application/xml",
            ),
            artifact_object=StoredObject(
                object_key="opaque/json",
                byte_size=10,
                sha256="d" * 64,
                content_type="application/json",
            ),
        )
        db.add(bundle)
        db.flush()
        db.add(ScoreRevisionPracticeBinding(revision_id=revision.id, bundle_id=bundle.id))
        for user_id, role in [(2, MembershipRole.PRACTITIONER), (3, MembershipRole.VIEWER)]:
            db.add(
                ScoreMembership(score_id=score.id, user_id=user_id, role=role, created_by_user_id=1)
            )
        db.commit()
    return postgres_engine


@pytest.mark.parametrize("mode,input_source,scope_kind", list(product(Mode, Input, Scope)))
def test_activity_records_only_authenticated_completed_execution_facts(
    database, monkeypatch, mode, input_source, scope_kind
):
    import app.modules.practice.activities.service as module

    now = utc_now()
    monkeypatch.setattr(module, "utc_now", lambda: now)
    with Session(database) as db:
        score = db.scalar(sa.select(Score).where(Score.score_uuid == "score"))
        before = (score.metadata_version, score.updated_at, score.head_revision_id)
        tables = [
            Notification,
            RealtimeChange,
            StorageUsageEvent,
            ScoreRevisionRenderOutbox,
            PlaybackOutbox,
            RevisionMetadataOutbox,
            ScoreLibraryOrganization,
        ]
        counts = {
            model: db.scalar(sa.select(sa.func.count()).select_from(model)) for model in tables
        }
        result = PracticeActivityService().create(
            db,
            2,
            request(
                mode=mode,
                input_source=input_source,
                scope={
                    "kind": scope_kind,
                    "start_tick": 0 if scope_kind is Scope.FULL else 100,
                    "terminal_tick": 480,
                },
            ),
        )
        row = db.scalar(sa.select(PracticeActivity))
        assert row.user_id == 2  # Personal practicing user, not Score owner.
        assert row.revision_id == before[2] and row.bundle_id == "bundle"
        assert (
            row.mode is mode and row.input_source is input_source and row.scope_kind is scope_kind
        )
        assert row.scope_terminal_tick == 480
        assert row.completed_at == now and result.completed_at == now
        assert result.activity_id == row.activity_uuid
        assert set(result.model_dump()) == {"activity_id", "completed_at"}
        db.refresh(score)
        assert (score.metadata_version, score.updated_at, score.head_revision_id) == before
        assert {
            model: db.scalar(sa.select(sa.func.count()).select_from(model)) for model in tables
        } == counts


def test_exact_replay_is_stable_and_sessions_are_scoped_to_the_practicing_user(database):
    with Session(database) as db:
        service = PracticeActivityService()
        original = service.create(db, 1, request())
        assert service.create(db, 1, request()) == original
        collaborator = service.create(db, 2, request())
        assert collaborator.activity_id != original.activity_id
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 2


@pytest.mark.parametrize(
    "change",
    [
        {"mode": "CONTINUOUS_PLAY"},
        {"input_source": "MICROPHONE"},
        {"scope": {"kind": "RANGE", "start_tick": 0, "terminal_tick": 480}},
        {"scope": {"kind": "FULL", "start_tick": 0, "terminal_tick": 960}},
        {
            "practice_binding": {
                "score_id": "score",
                "revision_id": "revision",
                "bundle_id": "different",
            }
        },
        {
            "practice_binding": {
                "score_id": "other",
                "revision_id": "foreign",
                "bundle_id": "other-bundle",
            }
        },
    ],
)
def test_conflicting_execution_identity_never_overwrites_activity(database, change):
    with Session(database) as db:
        service = PracticeActivityService()
        original = service.create(db, 1, request())
        with pytest.raises(ConflictException) as error:
            service.create(db, 1, request(**change))
        assert error.value.code is CustomerErrorCode.PRACTICE_ACTIVITY_CONFLICT
        assert service.create(db, 1, request()) == original
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 1


@pytest.mark.parametrize(
    "user_id,change",
    [
        (3, {}),
        (4, {}),
        (
            1,
            {
                "practice_binding": {
                    "score_id": "score",
                    "revision_id": "foreign",
                    "bundle_id": "bundle",
                }
            },
        ),
        (
            1,
            {
                "practice_binding": {
                    "score_id": "score",
                    "revision_id": "revision",
                    "bundle_id": "wrong",
                }
            },
        ),
    ],
)
def test_access_and_exact_revision_bundle_provenance_are_required(database, user_id, change):
    with Session(database) as db:
        with pytest.raises(AppException):
            PracticeActivityService().create(db, user_id, request(**change))
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 0


@pytest.mark.parametrize("unavailable", ["deleted", "unbound", "creating"])
def test_live_practice_authority_and_a_ready_binding_are_required(database, unavailable):
    with Session(database) as db:
        if unavailable == "deleted":
            db.scalar(sa.select(Score).where(Score.score_uuid == "score")).deleted_at = utc_now()
        elif unavailable == "unbound":
            db.execute(sa.delete(ScoreRevisionPracticeBinding))
        else:
            row = db.scalar(sa.select(PracticeBundleRecord))
            row.status = PracticeBundleStatus.CREATING
            row.prepared_musicxml_object_id = row.artifact_object_id = None
            row.creation_expires_at = utc_now() + timedelta(minutes=1)
        db.commit()
        with pytest.raises(AppException):
            PracticeActivityService().create(db, 1, request())
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 0


@pytest.mark.parametrize("conflict", [False, True])
def test_postgres_unique_fence_serializes_simultaneous_session_submissions(
    database, monkeypatch, conflict
):
    barrier = Barrier(2)
    find = PracticeActivityService._existing

    def simultaneous(*args):
        row = find(*args)
        if row is None:
            barrier.wait(10)
        return row

    monkeypatch.setattr(PracticeActivityService, "_existing", staticmethod(simultaneous))

    def create(mode):
        with Session(database) as db:
            try:
                result = PracticeActivityService().create(db, 1, request(mode=mode))
                db.commit()
                return result
            except ConflictException as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(create, mode)
            for mode in [Mode.STEP_BY_STEP, Mode.CONTINUOUS_PLAY if conflict else Mode.STEP_BY_STEP]
        ]
        results = [future.result(15) for future in futures]
    with Session(database) as db:
        row = db.scalar(sa.select(PracticeActivity))
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 1
        accepted = [value for value in results if isinstance(value, PracticeActivityRead)]
        assert all(value.activity_id == row.activity_uuid for value in accepted)
        assert len(accepted) == (1 if conflict else 2)
        if conflict:
            assert CustomerErrorCode.PRACTICE_ACTIVITY_CONFLICT in results


def test_command_rolls_back_on_commit_failure(database, monkeypatch):
    from contextlib import contextmanager
    from app.api.deps import get_command_db

    with Session(database) as db:
        monkeypatch.setattr(
            db, "commit", lambda: (_ for _ in ()).throw(RuntimeError("commit unavailable"))
        )
        with pytest.raises(RuntimeError):
            with contextmanager(get_command_db)(db):
                PracticeActivityService().create(db, 1, request())
    with Session(database) as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 0


def test_outer_command_failure_rolls_back_a_released_activity_savepoint(database):
    from contextlib import contextmanager
    from app.api.deps import get_command_db

    with Session(database) as db:
        with pytest.raises(RuntimeError, match="endpoint interrupted"):
            with contextmanager(get_command_db)(db):
                PracticeActivityService().create(db, 1, request())
                assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 1
                raise RuntimeError("endpoint interrupted")
    with Session(database) as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 0


def test_activity_provenance_does_not_pin_bundle_representations(database):
    with Session(database) as db:
        result = PracticeActivityService().create(db, 1, request())
        db.execute(sa.delete(ScoreRevisionPracticeBinding))
        db.execute(sa.delete(PracticeBundleRecord))
        db.commit()
        assert db.scalar(sa.select(PracticeActivity)).activity_uuid == result.activity_id


@pytest.mark.parametrize("target", ["user", "score"])
def test_activity_follows_user_and_revision_cascade_without_title_snapshots(database, target):
    with Session(database) as db:
        PracticeActivityService().create(db, 2, request())
        if target == "user":
            db.execute(sa.delete(ScoreMembership).where(ScoreMembership.user_id == 2))
            db.execute(sa.delete(User).where(User.id == 2))
        else:
            score = db.scalar(sa.select(Score).where(Score.score_uuid == "score"))
            score.deleted_at = utc_now()
            db.commit()
            assert db.scalar(sa.select(PracticeActivity)) is not None
            score.head_revision_id = None
            db.flush()
            db.delete(score)
        db.commit()
        assert db.scalar(sa.select(PracticeActivity)) is None


@pytest.mark.parametrize(
    "extra",
    [
        "user_id",
        "result",
        "evaluation",
        "assignment",
        "attempt",
        "strike",
        "recording",
        "media",
        "duration_ms",
        "tempo",
        "completed_at",
    ],
)
def test_activity_request_admits_no_user_timestamp_or_rich_execution_values(extra):
    with pytest.raises(ValidationError):
        request(**{extra: {"private": True}})


def test_current_vocabulary_columns_and_dependencies_are_narrow():
    from app.db.models import PerformanceTake
    from app.modules.practice.activities import service, schemas

    assert {value.value for value in Mode} == {"STEP_BY_STEP", "CONTINUOUS_PLAY"}
    assert {value.value for value in Input} == {"MICROPHONE", "MIDI"}
    assert {value.value for value in Scope} == {"FULL", "RANGE"}
    assert set(PracticeActivity.__table__.columns.keys()) == {
        "id",
        "activity_uuid",
        "user_id",
        "revision_id",
        "client_session_id",
        "bundle_id",
        "mode",
        "input_source",
        "scope_kind",
        "scope_start_tick",
        "scope_terminal_tick",
        "completed_at",
    }
    assert set(PracticeActivityCreateRequest.model_fields) == {
        "client_session_id",
        "practice_binding",
        "mode",
        "input_source",
        "scope",
    }
    assert not PracticeActivity.__table__.c.bundle_id.foreign_keys
    assert not {fk.column.table.name for fk in PracticeActivity.__table__.foreign_keys} & {
        "performance_takes",
        "practice_bundles",
        "stored_objects",
    }
    assert not any(
        fk.column.table.name == "practice_activities"
        for fk in PerformanceTake.__table__.foreign_keys
    )
    for module in [service, schemas]:
        imports = [
            node.module
            for node in ast.walk(ast.parse(Path(module.__file__).read_text()))
            if isinstance(node, ast.ImportFrom)
        ]
        assert not any(
            name
            and name.startswith(
                (
                    "app.storage",
                    "app.modules.storage_usage",
                    "app.modules.storage_objects",
                    "app.modules.performance_takes",
                    "app.processing",
                )
            )
            for name in imports
        )


def test_http_contract_is_authenticated_typed_and_personal(database):
    from app.main import create_app
    from app.api.deps import get_db, get_current_user

    app = create_app()
    with Session(database) as db:

        def session():
            yield db

        app.dependency_overrides[get_db] = session
        with TestClient(app) as client:
            assert client.post("/api/v1/practice-activities", json=payload()).status_code == 401
            app.dependency_overrides[get_current_user] = lambda: db.get(User, 2)
            response = client.post("/api/v1/practice-activities", json=payload())
            assert response.status_code == 200 and set(response.json()) == {
                "activity_id",
                "completed_at",
            }
            assert (
                client.post("/api/v1/practice-activities", json=payload()).json() == response.json()
            )
            conflicting = client.post(
                "/api/v1/practice-activities", json=payload(input_source="MICROPHONE")
            )
            assert (
                conflicting.status_code == 409
                and conflicting.json()["code"] == "practice_activity_conflict"
            )
            assert (
                client.post("/api/v1/practice-activities", json=payload(result={})).status_code
                == 422
            )
        spec = app.openapi()
        operations = spec["paths"]["/api/v1/practice-activities"]
        assert set(operations) == {"post"}
        assert operations["post"]["operationId"] == "practiceActivityCreate"
        schemas = spec["components"]["schemas"]
        assert set(schemas["PracticeActivityRead"]["properties"]) == {"activity_id", "completed_at"}
        assert schemas["PracticeActivityCreateRequest"]["additionalProperties"] is False


@pytest.mark.parametrize(
    "column,value",
    [
        ("scope_start_tick", -1),
        ("scope_terminal_tick", 0),
        ("mode", "UNSUPPORTED"),
        ("input_source", "CAMERA"),
        ("scope_kind", "OTHER"),
        ("activity_uuid", None),
        ("user_id", None),
        ("revision_id", None),
        ("client_session_id", None),
        ("bundle_id", None),
        ("completed_at", None),
    ],
)
def test_postgres_enforces_lightweight_activity_current_schema(database, column, value):
    with Session(database) as db:
        PracticeActivityService().create(db, 1, request())
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(
                sa.text(f"UPDATE practice_activities SET {column} = :value"), {"value": value}
            )
            db.commit()
        db.rollback()
        assert db.scalar(sa.select(sa.func.count()).select_from(PracticeActivity)) == 1


def test_postgres_activity_uuid_is_unique_independently_of_client_identity(database):
    with Session(database) as db:
        PracticeActivityService().create(db, 1, request())
        db.commit()
        values = dict(db.execute(sa.select(PracticeActivity.__table__)).mappings().one())
        values.pop("id")
        values["client_session_id"] = "different-session"
        with pytest.raises(IntegrityError):
            db.execute(sa.insert(PracticeActivity).values(**values))
            db.commit()
        db.rollback()


@pytest.mark.parametrize(
    "scope",
    [
        {"kind": "FULL", "start_tick": 0, "terminal_tick": 0},
        {"kind": "RANGE", "start_tick": 100, "terminal_tick": 99},
        {"kind": "FULL", "start_tick": False, "terminal_tick": 1},
        {"kind": "FULL", "start_tick": 0, "terminal_tick": 1, "tempo": 120},
    ],
)
def test_public_scope_is_a_strict_positive_integer_span(scope):
    with pytest.raises(ValidationError):
        request(scope=scope)
