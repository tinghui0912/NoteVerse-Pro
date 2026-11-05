"""Fresh PostgreSQL persistence for independent media provenance."""

from datetime import timedelta
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from alembic import command
from app.db.models import (
    User,
    PerformanceTakeUploadReservation,
    PerformanceTake,
    PerformanceTakeMediaKind,
)
from app.utils.timezone import utc_now_naive
from tests.test_practice_source_migration import migration_database, assert_current_source_schema


def reservation_values(user_id):
    return PerformanceTakeUploadReservation(
        user_id=user_id,
        reservation_uuid="reservation",
        client_request_id="request",
        take_uuid="take",
        source_id="source-fingerprint",
        source_score_uuid="score",
        source_revision_uuid="revision",
        source_artifact_id="artifact",
        score_title_snapshot="Title at admission",
        scope_type="FULL",
        ticks_per_quarter=1,
        scope_start_tick=0,
        scope_terminal_tick=4,
        tempo_plan="{}",
        recording_timebase="{}",

        media_kind="AUDIO",
        media_mime_type="audio/webm",
        media_byte_size=10,
        storage_backend="local",
        staging_object_key="staging",
        storage_reservation_id="quota",
        expires_at=utc_now_naive() + timedelta(hours=1),
        status="RESERVED",
    ).model_dump(exclude={"id"})


def test_fresh_reservation_and_take_store_provenance_without_a_source_row(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        assert_current_source_schema(engine)
        with Session(engine) as db:
            user = User(email="snapshot@example.com", display_name="Snapshot", password_hash="test")
            db.add(user)
            db.commit()
            row = PerformanceTakeUploadReservation(**reservation_values(user.id))
            db.add(row)
            db.flush()
            take = PerformanceTake(
                user_id=user.id,
                take_uuid="take",
                upload_reservation_id=row.id,
                source_id=row.source_id,
                source_score_uuid=row.source_score_uuid,
                source_revision_uuid=row.source_revision_uuid,
                source_artifact_id=row.source_artifact_id,
                score_title_snapshot=row.score_title_snapshot,
                media_kind=PerformanceTakeMediaKind.AUDIO,
                media_mime_type="audio/webm",
                media_byte_size=10,
                media_object_key="media",
                storage_backend="local",

                scope_type="FULL",
                ticks_per_quarter=1,
                scope_start_tick=0,
                scope_terminal_tick=4,
                tempo_plan="{}",
                recording_timebase="{}",
            )
            db.add(take)
            db.commit()
            db.refresh(take)
            assert (
                take.source_id == "source-fingerprint"
                and take.score_title_snapshot == "Title at admission"
            )
            assert db.scalar(sa.text("SELECT count(*) FROM practice_sources")) == 0
            duplicate = PerformanceTake(
                **{
                    **take.model_dump(exclude={"id"}),
                    "take_uuid": "duplicate",
                    "media_object_key": "other",
                }
            )
            db.add(duplicate)
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
