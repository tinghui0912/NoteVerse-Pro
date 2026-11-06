"""Fresh PostgreSQL persistence for independent media provenance."""

import hashlib
from tests.test_performance_takes import VALID_WEBM_BYTES
from datetime import timedelta
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from alembic import command
from app.db.models import (
    MediaBlob,
    User,
    PerformanceTakeUploadReservation,
    PerformanceTake,
)
from app.utils.timezone import utc_now_naive
from tests.test_practice_bundle_migration import migration_database, assert_current_bundle_schema


def manifest_values(user_id):
    from tests.test_take_manifest import value
    from app.modules.performance_takes.manifest_persistence import manifest_to_row

    row = manifest_to_row(value())
    row.user_id = user_id
    return row.model_dump(exclude={"id"})


def reservation_values(user_id, manifest_id):
    return PerformanceTakeUploadReservation(
        user_id=user_id,
        manifest_id=manifest_id,
        reservation_uuid="reservation",
        client_request_id="request",
        storage_backend="local",
        staging_object_key="staging",
        storage_reservation_id="quota",
        expires_at=utc_now_naive() + timedelta(hours=1),
        status="RESERVED",
    ).model_dump(exclude={"id"})


def test_fresh_manifest_shared_by_reservation_and_take(monkeypatch):
    from app.db.models import PerformanceTakeManifest

    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        assert_current_bundle_schema(engine)
        with Session(engine) as db:
            user = User(email="snapshot@example.com", display_name="Snapshot", password_hash="test")
            db.add(user)
            db.flush()
            manifest = PerformanceTakeManifest(
                user_id=user.id,
                take_uuid="take",
                practice_bundle_id="bundle-fingerprint",
                practice_score_uuid="score",
                practice_revision_uuid="revision",
                practice_artifact_id="artifact",
                score_title_snapshot="Title at admission",
                scope_type="FULL",
                ticks_per_quarter=1,
                scope_start_tick=0,
                scope_terminal_tick=4,
                tempo_plan="{}",
                recording_timebase="{}",
                capture_kind="AUDIO",
                capture_mime_type="audio/webm",
                capture_byte_size=10,
            )
            db.add(manifest)
            db.flush()
            row = PerformanceTakeUploadReservation(
                user_id=user.id,
                manifest_id=manifest.id,
                reservation_uuid="reservation",
                client_request_id="request",
                storage_backend="local",
                staging_object_key="staging",
                storage_reservation_id="quota",
                expires_at=utc_now_naive() + timedelta(hours=1),
                status="RESERVED",
            )
            take = PerformanceTake(
                manifest_id=manifest.id,
                media_blob=MediaBlob(
                    storage_backend="local",
                    object_key="media",
                    byte_size=len(VALID_WEBM_BYTES),
                    sha256=hashlib.sha256(VALID_WEBM_BYTES).hexdigest(),
                    content_type="audio/webm",
                ),
            )
            db.add_all([row, take])
            db.commit()
            assert row.manifest_id == take.manifest_id == manifest.id
            assert db.scalar(sa.text("SELECT count(*) FROM practice_bundles")) == 0
            db.add(
                PerformanceTake(
                    manifest_id=manifest.id,
                    media_blob=MediaBlob(
                        storage_backend="local",
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
            db.add(
                PerformanceTakeUploadReservation(
                    user_id=other.id,
                    manifest_id=manifest.id,
                    reservation_uuid="other",
                    client_request_id="request",
                    storage_backend="local",
                    staging_object_key="other-staging",
                    storage_reservation_id="other-quota",
                    expires_at=utc_now_naive() + timedelta(hours=1),
                    status="RESERVED",
                )
            )
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
