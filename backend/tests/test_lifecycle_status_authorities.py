"""Canonical lifecycle vocabularies are projected through ORM and PostgreSQL."""

from tests.support.quota import quota_hold_fact
from tests.support.uploads import settled_upload_session

import ast
from datetime import timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.durable_delivery import delivery_attempt_token_constraint
from app.db.models import (
    PerformanceTakeManifest,
    PerformanceTakeUploadReservation,
    PracticeBundleRecord,
    StoredObject,
    User,
)
from app.modules.practice.bundle.states import PracticeBundleStatus
from app.db.models.revision_metadata_outbox import RevisionMetadataOutbox
from app.modules.metadata.delivery_states import RevisionMetadataOutboxStatus
from app.db.models.object_write_intent import ObjectWriteIntent
from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.db.models.stored_object_retirement import StoredObjectRetirement
from app.modules.media_storage.domain import StoredObjectRetirementStatus
from app.modules.performance_takes.upload_reservation.states import UploadReservationStatus
from app.shared.time import utc_now
from tests.test_delivery_attempt_postgres import database  # noqa: F401
from tests.test_performance_take_schema import manifest_values
from app.runtime.customer_api.context import get_context
from tests.support.runtime_resources import deliveries

settings = get_context().settings

CONTRACTS = [
    (RevisionMetadataOutbox, RevisionMetadataOutboxStatus),
    (PerformanceTakeUploadReservation, UploadReservationStatus),
    (PracticeBundleRecord, PracticeBundleStatus),
    (ObjectWriteIntent, ObjectWriteIntentStatus),
    (StoredObjectRetirement, StoredObjectRetirementStatus),
]


@pytest.mark.parametrize("model,status_type", CONTRACTS)
def test_model_status_projects_its_canonical_enum(model, status_type):
    assert model.model_fields["status"].annotation is status_type
    column = model.__table__.c.status
    assert isinstance(column.type, sa.Enum)
    assert column.type.enum_class is status_type
    assert column.type.native_enum is False
    assert column.type.create_constraint is True
    assert set(column.type.enums) == {status.value for status in status_type}
    vocabulary = [c for c in model.__table__.constraints if c.name == column.type.name]
    assert len(vocabulary) == 1
    # Its SQL admission is supplied by the column's Enum type, not a second list.
    assert vocabulary[0]._type_bound
    definitions = [
        path
        for path in (Path(__file__).parents[1] / "app").rglob("*.py")
        if any(
            isinstance(node, ast.ClassDef) and node.name == status_type.__name__
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        )
    ]
    assert len(definitions) == 1


@pytest.fixture
def status_database(database):  # noqa: F811 - imported PostgreSQL fixture
    with Session(database) as db:
        user = db.scalar(sa.select(User))
        manifest = PerformanceTakeManifest(**manifest_values(user.id))
        db.add(manifest)
        objects = [
            StoredObject(
                object_key="status/" + str(i),
                byte_size=1,
                sha256="a" * 64,
                content_type="application/octet-stream",
            )
            for i in range(2)
        ]
        db.add_all(objects)
        db.flush()
        db.add_all(
            [
                PracticeBundleRecord(
                    bundle_id="status-bundle",
                    artifact_id="artifact",
                    artifact_schema_version=1,
                    status=PracticeBundleStatus.CREATING,
                    creation_expires_at=utc_now() + timedelta(hours=1),
                ),
                PerformanceTakeUploadReservation(
                    user_id=user.id,
                    manifest_id=manifest.id,
                    client_request_id="status",
                    upload_session=settled_upload_session(user_id=user.id),
                    quota_hold_id=quota_hold_fact(db, user.id),
                    expires_at=utc_now() + timedelta(hours=1),
                ),
            ]
        )
        db.commit()
        object_ids = [row.id for row in objects]
    return database, object_ids


def state_values(model, status, object_ids):
    values = {"status": status}
    if model in (RevisionMetadataOutbox, ObjectWriteIntent, StoredObjectRetirement):
        processing = (
            ObjectWriteIntentStatus.CLEANUP_PROCESSING
            if model is ObjectWriteIntent
            else model.__table__.c.status.type.enum_class.PROCESSING
        )
        values["attempt_token"] = "lease" if status is processing else None
    elif model is PracticeBundleRecord:
        ready = status is PracticeBundleStatus.READY
        values.update(
            creation_expires_at=None if ready else utc_now(),
            prepared_musicxml_object_id=object_ids[0] if ready else None,
            artifact_object_id=object_ids[1] if ready else None,
        )
    elif model is PerformanceTakeUploadReservation:
        active = status is UploadReservationStatus.FINALIZING
        values.update(
            finalizing_token="lease" if active else None,
            finalizing_expires_at=utc_now() if active else None,
        )
    return values


@pytest.mark.parametrize("model,status_type", CONTRACTS)
def test_postgresql_accepts_every_canonical_status_and_loads_enum(
    status_database, model, status_type
):
    engine, object_ids = status_database
    with Session(engine) as db:
        for status in status_type:
            savepoint = db.begin_nested()
            db.execute(sa.update(model).values(**state_values(model, status, object_ids)))
            db.expire_all()
            assert db.scalar(sa.select(model)).status is status
            assert db.scalar(sa.text(f'SELECT status FROM "{model.__tablename__}"')) == status.value
            savepoint.rollback()
        with pytest.raises(sa.exc.IntegrityError) as error:
            db.execute(
                sa.text(f'UPDATE "{model.__tablename__}" SET status = :status'),
                {"status": "INVALID"},
            )
            db.commit()
        assert error.value.orig.sqlstate == "23514"
        db.rollback()


@pytest.mark.parametrize(
    "model,status,patch",
    [
        (PracticeBundleRecord, PracticeBundleStatus.CREATING, {"creation_expires_at": None}),
        (PracticeBundleRecord, PracticeBundleStatus.READY, {"artifact_object_id": None}),
        (
            PerformanceTakeUploadReservation,
            UploadReservationStatus.FINALIZING,
            {"finalizing_token": None},
        ),
        (
            PerformanceTakeUploadReservation,
            UploadReservationStatus.RESERVED,
            {"finalizing_token": "foreign"},
        ),
    ],
)
def test_state_specific_database_invariants_remain_enforced(status_database, model, status, patch):
    engine, object_ids = status_database
    with Session(engine) as db:
        with pytest.raises(sa.exc.IntegrityError) as error:
            db.execute(sa.update(model).values(**(state_values(model, status, object_ids) | patch)))
            db.commit()
        assert error.value.orig.sqlstate == "23514"
        db.rollback()


def test_attempt_token_constraint_consumes_enum_authority():
    for status in (
        RevisionMetadataOutboxStatus.PROCESSING,
        ObjectWriteIntentStatus.CLEANUP_PROCESSING,
    ):
        check = delivery_attempt_token_constraint(name="contract", processing_status=status)
        assert status.value in str(check.sqltext)
    with pytest.raises(TypeError):
        delivery_attempt_token_constraint(name="contract", processing_status="PROCESSING")


def test_metadata_batch_limit_uses_current_settings(status_database, monkeypatch):
    from app.db.models import ScoreRevision
    from app.modules.revisions.domain import RevisionOrigin

    engine, _ = status_database
    with Session(engine) as db:
        score_id = db.scalar(sa.select(ScoreRevision.score_id))
        revision = ScoreRevision(
            score_id=score_id,
            revision_uuid="metadata-second",
            revision_number=2,
            content_hash="b" * 64,
            origin=RevisionOrigin.EDIT,
        )
        db.add(revision)
        db.flush()
        db.add(RevisionMetadataOutbox(revision_id=revision.id, source_fingerprint="b" * 64))
        db.commit()
        monkeypatch.setattr(
            deliveries().metadata.config, "REVISION_METADATA_DISPATCH_BATCH_SIZE", 1
        )
        assert len(deliveries().metadata.recover_and_list_due(db)) == 1
        monkeypatch.setattr(
            deliveries().metadata.config, "REVISION_METADATA_DISPATCH_BATCH_SIZE", 2
        )
        assert len(deliveries().metadata.recover_and_list_due(db)) == 2
