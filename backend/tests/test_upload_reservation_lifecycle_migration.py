"""Real PostgreSQL upgrade and executable lifecycle constraint boundaries."""

from datetime import timedelta
import json

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from alembic import command

from app.db.models import User, PerformanceTake, StorageUsageAccount, StorageUsageCounter, StorageUsageCategory, PerformanceTakeMediaKind
from app.db.models.storage_usage import StorageUsageReservation, StorageUsageReservationStatus
from app.utils.timezone import utc_now_naive
from tests.test_practice_source_migration import migration_database, assert_current_source_schema


def test_lifecycle_upgrade_normalizes_cleanup_ownership_and_enforces_state_tuples(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0056_practice_source_provenance")
        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=engine)
        sources = sa.Table("practice_sources", metadata, autoload_with=engine)
        reservations = sa.Table(
            "performance_take_upload_reservations", metadata, autoload_with=engine
        )
        quota = sa.Table("storage_usage_reservations", metadata, autoload_with=engine)
        accounts = sa.Table("storage_usage_accounts", metadata, autoload_with=engine)
        counters = sa.Table("storage_usage_counters", metadata, autoload_with=engine)
        takes = sa.Table("performance_takes", metadata, autoload_with=engine)
        now = utc_now_naive()
        with engine.begin() as connection:
            user_id = connection.execute(
                users.insert()
                .values(
                    **User(
                        email="lifecycle@example.com",
                        display_name="Lifecycle",
                        password_hash="test",
                    ).model_dump(exclude={"id"})
                )
                .returning(users.c.id)
            ).scalar_one()
            source_id = connection.execute(
                sources.insert()
                .values(
                    source_id="canonical-source",
                    source_score_uuid="score",
                    source_revision_uuid="revision",
                    artifact_id="artifact",
                    artifact_schema_version=1,
                    prepared_musicxml_object_key="source.xml",
                    prepared_musicxml_sha256="a" * 64,
                    prepared_musicxml_byte_size=10,
                    artifact_object_key="artifact.json",
                    artifact_sha256="b" * 64,
                    artifact_byte_size=10,
                    status="READY",
                    created_at=now,
                )
                .returning(sources.c.id)
            ).scalar_one()
            values = dict(
                reservation_uuid="reservation",
                user_id=user_id,
                practice_source_id=source_id,
                client_request_id="request",
                take_uuid="take",
                score_title="Score",
                scope_type="FULL",
                scope_start_beat=0,
                scope_terminal_beat=4,
                tempo_plan="{}",
                recording_timebase="{}",
                duration_ms=1000,
                media_kind="AUDIO",
                media_mime_type="audio/webm",
                media_byte_size=10,
                storage_backend="local",
                staging_object_key="staging",
                storage_reservation_id="quota",
                expires_at=now + timedelta(hours=1),
                status="FINALIZING",
                finalizing_token="token",
                finalizing_object_key="candidate",
                finalizing_expires_at=now + timedelta(minutes=15),
                final_object_key="duplicate",
                orphan_final_object_keys='["uncertain",{"key":"known","remove_after":null}]',
                created_at=now,
                updated_at=now,
            )
            row_id = connection.execute(
                reservations.insert().values(**values).returning(reservations.c.id)
            ).scalar_one()
            connection.execute(
                reservations.insert().values(
                    **{
                        **values,
                        "reservation_uuid": "partial",
                        "take_uuid": "partial",
                        "client_request_id": "partial",
                        "finalizing_token": None,
                        "finalizing_object_key": "abandoned",
                        "final_object_key": "abandoned",
                    }
                )
            )
            connection.execute(
                reservations.insert().values(
                    **{
                        **values,
                        "reservation_uuid": "terminal",
                        "take_uuid": "terminal",
                        "client_request_id": "terminal",
                        "status": "CANCELLED",
                        "storage_reservation_id": "quota-terminal",
                    }
                )
            )
            complete_id = connection.execute(reservations.insert().values(**{
                **values, "reservation_uuid":"complete", "client_request_id":"complete", "take_uuid":"complete",
                "storage_reservation_id":"quota-complete", "final_object_key":"durable"}).returning(reservations.c.id)).scalar_one()
            connection.execute(takes.insert().values(**PerformanceTake(
                take_uuid="complete", user_id=user_id, practice_source_id=source_id,
                score_title_snapshot="Score", upload_reservation_id=complete_id,
                media_kind=PerformanceTakeMediaKind.AUDIO, media_mime_type="audio/webm", media_byte_size=10,
                media_object_key="durable", storage_backend="local", duration_ms=1000,
                scope_type="FULL", scope_start_beat=0, scope_terminal_beat=4,
                tempo_plan="{}", recording_timebase="{}").model_dump(exclude={"id"})))
            connection.execute(accounts.insert().values(**StorageUsageAccount(user_id=user_id,
                plan_code="FREE", quota_limit_bytes=1000, used_bytes=0, reserved_bytes=20).model_dump(exclude={"id"})))
            connection.execute(counters.insert().values(**StorageUsageCounter(user_id=user_id,
                category=StorageUsageCategory.UPLOAD, used_bytes=0, reserved_bytes=20).model_dump(exclude={"id"})))
            for handle in ["quota-terminal", "quota-complete"]:
                connection.execute(quota.insert().values(**StorageUsageReservation(reservation_uuid=handle,
                    user_id=user_id, category=StorageUsageCategory.UPLOAD, bytes_reserved=10,
                    counts_toward_quota=True, status=StorageUsageReservationStatus.RESERVED,
                    reason="performance_take_upload_reservation").model_dump(exclude={"id"})))
        command.upgrade(config, "head")
        assert_current_source_schema(engine)
        current = sa.Table(reservations.name, sa.MetaData(), autoload_with=engine)
        with engine.connect() as connection:
            row = (
                connection.execute(sa.select(current).where(current.c.id == row_id))
                .mappings()
                .one()
            )
            assert row["status"] == "FINALIZING" and row["practice_source_id"] == source_id
            assert row["finalizing_object_key"] == "candidate"
            entries = json.loads(row["orphan_final_object_keys"])
            assert {item["key"] for item in entries} == {"uncertain", "known", "duplicate"}
            assert all(
                set(item) == {"key", "remove_after"} and item["remove_after"] for item in entries
            )
            account = connection.execute(sa.select(accounts)).mappings().one()
            counter = connection.execute(sa.select(counters)).mappings().one()
            assert account["reserved_bytes"] == counter["reserved_bytes"] == 0
            assert account["used_bytes"] == counter["used_bytes"] == 10
            statuses = dict(connection.execute(sa.select(quota.c.reservation_uuid, quota.c.status)).all())
            assert statuses == {"quota-terminal":"RELEASED", "quota-complete":"COMMITTED"}
            completed = connection.execute(sa.select(current).where(current.c.id == complete_id)).mappings().one()
            assert completed["status"] == "COMPLETED" and completed["practice_source_id"] is None
            assert "durable" not in completed["orphan_final_object_keys"]
            partial = (
                connection.execute(
                    sa.select(current).where(current.c.reservation_uuid == "partial")
                )
                .mappings()
                .one()
            )
            assert partial["status"] == "RESERVED" and partial["finalizing_token"] is None
            assert "abandoned" in partial["orphan_final_object_keys"]
            terminal = (
                connection.execute(
                    sa.select(current).where(current.c.reservation_uuid == "terminal")
                )
                .mappings()
                .one()
            )
            assert (
                terminal["practice_source_id"] is None and terminal["finalizing_object_key"] is None
            )
        for invalid in [
            {
                "status": "RESERVED",
                "practice_source_id": None,
                "finalizing_token": None,
                "finalizing_object_key": None,
                "finalizing_expires_at": None,
            },
            {"status": "RESERVED"},
            {"status": "FINALIZING", "practice_source_id": None},
            {"finalizing_token": None},
            {"finalizing_object_key": None},
            {"finalizing_expires_at": None},
            {"status": "COMPLETED"},
            {"status": "COMPLETED", "practice_source_id": None},
            {"status": "CANCELLED"},
            {"status": "EXPIRED"},
            {"status": "INVALID"},
        ]:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(current.update().where(current.c.id == row_id).values(**invalid))
        # A legitimate terminal tuple releases the source and all lease columns together.
        with engine.begin() as connection:
            connection.execute(
                current.update()
                .where(current.c.id == row_id)
                .values(
                    status="CANCELLED",
                    practice_source_id=None,
                    finalizing_token=None,
                    finalizing_object_key=None,
                    finalizing_expires_at=None,
                )
            )
