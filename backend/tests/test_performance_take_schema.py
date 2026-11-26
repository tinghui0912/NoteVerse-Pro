"""Fresh PostgreSQL persistence for independent media provenance."""

from tests.support.quota import quota_hold_fact

from app.modules.performance_takes.upload_reservation.states import UploadReservationStatus

import hashlib
from tests.test_performance_takes import VALID_WEBM_BYTES
from datetime import timedelta
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, DataError
from alembic import command
from app.db.models import (
    StoredObject,
    User,
    PerformanceTakeUploadReservation,
    PerformanceTake,
)
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


def manifest_values(user_id):
    from tests.test_take_manifest import value
    from app.modules.performance_takes.manifest_persistence import manifest_to_row

    row = manifest_to_row(value())
    row.user_id = user_id
    return row.model_dump(exclude={"id"})


def reservation_values(user_id, manifest_id, quota_hold_id):
    return PerformanceTakeUploadReservation(
        user_id=user_id,
        manifest_id=manifest_id,
        reservation_uuid="reservation",
        client_request_id="request",
        staging_object_key="staging",
        quota_hold_id=quota_hold_id,
        expires_at=utc_now() + timedelta(hours=1),
        status=UploadReservationStatus.RESERVED,
    ).model_dump(exclude={"id"})


def test_fresh_manifest_shared_by_reservation_and_take(monkeypatch):
    from app.db.models import PerformanceTakeManifest

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            user = User(email="snapshot@example.com", display_name="Snapshot", password_hash="test")
            db.add(user)
            db.flush()
            manifest = PerformanceTakeManifest(**manifest_values(user.id))
            db.add(manifest)
            db.flush()
            row = PerformanceTakeUploadReservation(
                user_id=user.id,
                manifest_id=manifest.id,
                reservation_uuid="reservation",
                client_request_id="request",
                staging_object_key="staging",
                quota_hold_id=quota_hold_fact(db, user.id),
                expires_at=utc_now() + timedelta(hours=1),
                status=UploadReservationStatus.RESERVED,
            )
            take = PerformanceTake(
                owner_user_id=user.id,
                manifest_id=manifest.id,
                recording_object=StoredObject(
                    object_key="media",
                    byte_size=len(VALID_WEBM_BYTES),
                    sha256=hashlib.sha256(VALID_WEBM_BYTES).hexdigest(),
                    content_type="audio/webm",
                ),
            )
            db.add_all([row, take])
            db.commit()
            assert row.manifest_id == take.manifest_id == manifest.id
            db.refresh(take)
            assert take.owner_user_id == manifest.user_id == user.id
            indexes = {
                index["name"]: index["column_names"]
                for index in sa.inspect(engine).get_indexes("performance_takes")
            }
            assert indexes["idx_performance_takes_owner_created"] == [
                "owner_user_id",
                "created_at",
                "id",
            ]
            assert indexes["idx_performance_takes_owner_score_created"] == [
                "owner_user_id",
                "linked_score_id",
                "created_at",
                "id",
            ]
            owner_fk = next(
                fk
                for fk in sa.inspect(engine).get_foreign_keys("performance_takes")
                if fk["name"] == "fk_performance_takes_manifest_owner"
            )
            assert owner_fk["constrained_columns"] == ["manifest_id", "owner_user_id"]
            assert owner_fk["referred_table"] == "performance_take_manifests"
            assert owner_fk["referred_columns"] == ["id", "user_id"]
            assert owner_fk["options"]["ondelete"] == "CASCADE"
            assert db.scalar(sa.text("SELECT count(*) FROM practice_bundles")) == 0
            db.add(
                PerformanceTake(
                    owner_user_id=user.id,
                    manifest_id=manifest.id,
                    recording_object=StoredObject(
                        object_key="other",
                        byte_size=len(VALID_WEBM_BYTES),
                        sha256=hashlib.sha256(VALID_WEBM_BYTES).hexdigest(),
                        content_type="audio/webm",
                    ),
                )
            )
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
            other = User(email="other@example.com", display_name="Other", password_hash="test")
            db.add(other)
            db.flush()
            with pytest.raises(IntegrityError) as mismatch:
                with db.begin_nested():
                    db.execute(
                        sa.update(PerformanceTake)
                        .where(PerformanceTake.id == take.id)
                        .values(owner_user_id=other.id)
                    )
            assert mismatch.value.orig.sqlstate == "23503"
            assert mismatch.value.orig.diag.constraint_name == "fk_performance_takes_manifest_owner"
            db.refresh(take)
            assert take.owner_user_id == user.id
            db.add(
                PerformanceTakeUploadReservation(
                    user_id=other.id,
                    manifest_id=manifest.id,
                    reservation_uuid="other",
                    client_request_id="request",
                    staging_object_key="other-staging",
                    quota_hold_id=quota_hold_fact(db, other.id),
                    expires_at=utc_now() + timedelta(hours=1),
                    status=UploadReservationStatus.RESERVED,
                )
            )
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()


def test_manifest_document_schema_and_digest_constraints(monkeypatch):
    from app.db.models import PerformanceTakeManifest
    from app.modules.performance_takes.manifest_persistence import manifest_from_row

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        assert {c["name"] for c in inspector.get_columns("performance_take_manifests")} == {
            "id",
            "user_id",
            "take_uuid",
            "manifest_json",
            "manifest_sha256",
            "created_at",
        }
        with Session(engine) as db:
            user = User(
                email="documents@example.com", display_name="Documents", password_hash="test"
            )
            db.add(user)
            db.flush()
            first = PerformanceTakeManifest(**manifest_values(user.id))
            second = PerformanceTakeManifest(
                **(manifest_values(user.id) | {"take_uuid": "another-take"})
            )
            db.add_all([first, second])
            db.commit()
            assert first.manifest_json == second.manifest_json
            assert first.manifest_sha256 == second.manifest_sha256
            assert first.id != second.id
            assert manifest_from_row(first).snapshot == manifest_from_row(second).snapshot
            for digest, sqlstate in [("a" * 63, "23514"), ("a" * 65, "22001")]:
                with pytest.raises((IntegrityError, DataError)) as error:
                    db.execute(
                        sa.update(PerformanceTakeManifest)
                        .where(PerformanceTakeManifest.id == first.id)
                        .values(manifest_sha256=digest)
                    )
                    db.commit()
                assert error.value.orig.sqlstate == sqlstate
                db.rollback()
            db.add(PerformanceTakeManifest(**manifest_values(user.id)))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
