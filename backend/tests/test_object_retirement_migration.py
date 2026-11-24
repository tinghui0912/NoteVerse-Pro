"""Durable deletion fence schema and existing attempted-operation safety."""

import pytest
from sqlalchemy import text, inspect
from alembic import command
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


@pytest.mark.parametrize(
    "status,attempts,fenced",
    [
        ("PENDING", 0, False),
        ("DISPATCHED", 1, True),
        ("PROCESSING", 1, True),
        ("FAILED", 1, True),
        ("CANCELLED", 0, False),
        ("COMPLETED", 1, False),
    ],
)
def test_upgrade_fences_attempted_unfinished_retirement(monkeypatch, status, attempts, fenced):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0002_storage_quota")
        now = utc_now()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO stored_object_retirements(retirement_uuid,object_key,byte_size,sha256,content_type,status,attempt_count,attempt_token,next_attempt_at,created_at,updated_at) VALUES ('operation','opaque',0,:sha,'application/octet-stream',:status,:attempts,:token,:now,:now,:now)"
                ),
                {
                    "sha": "a" * 64,
                    "status": status,
                    "attempts": attempts,
                    "token": "lease" if status == "PROCESSING" else None,
                    "now": now,
                },
            )
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT deletion_fenced_at FROM stored_object_retirements"))
                is not None
            ) == fenced
        if fenced:
            with pytest.raises(RuntimeError, match="must complete"):
                command.downgrade(config, "0002_storage_quota")
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE stored_object_retirements SET status='COMPLETED', attempt_token=NULL"
                    )
                )
        command.downgrade(config, "0002_storage_quota")
        with engine.connect() as connection:
            assert "deletion_fenced_at" not in {
                column["name"]
                for column in inspect(connection).get_columns("stored_object_retirements")
            }
        command.upgrade(config, "head")


@pytest.mark.parametrize("attempts", [1, 4])
def test_cancelled_attempt_preflight_refuses_before_schema_or_record_changes(monkeypatch, attempts):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0002_storage_quota")
        now = utc_now()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO stored_object_retirements(retirement_uuid,object_key,byte_size,sha256,content_type,status,attempt_count,next_attempt_at,created_at,updated_at) "
                    "VALUES ('ambiguous-cancellation','opaque-cancelled',0,:sha,'application/octet-stream','CANCELLED',:attempts,:now,:now,:now)"
                ),
                {"sha": "a" * 64, "attempts": attempts, "now": now},
            )
        columns = [
            (c["name"], str(c["type"]), c["nullable"], c["default"])
            for c in inspect(engine).get_columns("stored_object_retirements")
        ]
        with engine.connect() as connection:
            before = (
                connection.execute(text("SELECT * FROM stored_object_retirements")).mappings().all()
            )
        with pytest.raises(RuntimeError) as raised:
            command.upgrade(config, "head")
        diagnostic = str(raised.value)
        assert "ambiguous-cancellation" in diagnostic
        assert "opaque-cancelled" in diagnostic
        assert f"attempts={attempts}" in diagnostic
        assert "before schema changes" in diagnostic
        assert "reconcile" in diagnostic
        assert [
            (c["name"], str(c["type"]), c["nullable"], c["default"])
            for c in inspect(engine).get_columns("stored_object_retirements")
        ] == columns
        with engine.connect() as connection:
            assert (
                connection.execute(text("SELECT * FROM stored_object_retirements")).mappings().all()
                == before
            )
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == "0002_storage_quota"
            )


def test_uncertain_legacy_delete_then_concurrent_cancellation_requires_reconciliation(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from hashlib import sha256
    from sqlalchemy import select, func
    from sqlalchemy.orm import Session, sessionmaker
    from app.db.models import StoredObject, StoredObjectRetirement, User, StorageUsageAccount
    from app.modules.storage_objects.persistence import object_from_bytes, object_from_row
    from app.modules.storage_objects.references import SEMANTIC_REFERENCES
    from app.modules.storage_objects.retirement import (
        retain_for_reference,
        retire_after_release,
        snapshot,
    )
    from app.worker.execution import stored_object_retirement as worker
    from tests.support.object_storage import InMemoryObjectStorage
    from tests.test_stored_object_retirement_postgres import assert_blocked

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0002_storage_quota")
        storage = InMemoryObjectStorage()
        content, key = b"verified avatar backup", "avatar/legacy-attempt"
        storage.put_bytes(key=key, content=content, content_type="image/png")
        with Session(engine) as db:
            obj = object_from_bytes(object_key=key, content=content, content_type="image/png")
            db.add(obj)
            db.add(User(id=1, email="owner@example.com", password_hash="hash"))
            db.flush()
            identity, facts = obj.id, object_from_row(obj)
            db.add(StorageUsageAccount(user_id=1, used_bytes=0))
            db.commit()
        now = utc_now()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO stored_object_retirements(retirement_uuid,stored_object_id,object_key,byte_size,sha256,content_type,status,attempt_count,next_attempt_at,created_at,updated_at) "
                    "VALUES ('legacy-delete',:id,:key,:size,:sha,'image/png','PENDING',0,:now,:now,:now)"
                ),
                {
                    "id": identity,
                    "key": key,
                    "size": len(content),
                    "sha": sha256(content).hexdigest(),
                    "now": now,
                },
            )
            # The old worker persisted its claim independently, before destructive IO.
            connection.execute(
                text(
                    "UPDATE stored_object_retirements SET status='PROCESSING',attempt_count=1,attempt_token='legacy-lease',started_at=:now WHERE retirement_uuid='legacy-delete'"
                ),
                {"now": now},
            )

        entered, pid = Event(), []

        def legacy_retention():
            with engine.begin() as connection:
                pid.append(connection.scalar(text("SELECT pg_backend_pid()")))
                entered.set()
                connection.execute(
                    text("SELECT id FROM stored_objects WHERE id=:id FOR UPDATE"), {"id": identity}
                )
                connection.execute(
                    text(
                        "SELECT id FROM stored_object_retirements WHERE retirement_uuid='legacy-delete' FOR UPDATE"
                    )
                )
                # Historical retain_for_reference admitted this cancellation without a fence.
                connection.execute(
                    text(
                        "UPDATE stored_object_retirements SET status='CANCELLED',attempt_token=NULL,completed_at=:now WHERE retirement_uuid='legacy-delete'"
                    ),
                    {"now": now},
                )
                connection.execute(
                    text("UPDATE users SET avatar_object_id=:id WHERE id=1"), {"id": identity}
                )

        with engine.connect() as deleting, ThreadPoolExecutor(max_workers=1) as pool:
            transaction = deleting.begin()
            deleting.execute(text("DELETE FROM stored_objects WHERE id=:id"), {"id": identity})
            storage.delete(key)
            retaining = pool.submit(legacy_retention)
            try:
                assert entered.wait(10)
                assert_blocked(engine, pid[0])
            finally:
                transaction.rollback()  # Physical IO survived the database completion rollback.
            retaining.result(10)
        assert not storage.exists(key)
        with engine.connect() as connection:
            before = (
                connection.execute(text("SELECT * FROM stored_object_retirements")).mappings().one()
            )
            assert before["status"] == "CANCELLED" and before["attempt_count"] == 1
            assert (
                connection.scalar(text("SELECT avatar_object_id FROM users WHERE id=1")) == identity
            )
        with pytest.raises(RuntimeError, match="legacy-delete"):
            command.upgrade(config, "head")
        assert "deletion_fenced_at" not in {
            c["name"] for c in inspect(engine).get_columns("stored_object_retirements")
        }
        with engine.connect() as connection:
            assert (
                connection.execute(text("SELECT * FROM stored_object_retirements")).mappings().one()
                == before
            )

        # Explicit reviewed resolution: restore and verify backup, inspect every semantic FK,
        # preserve the avatar and its non-quota accounting, then resume this same operation.
        storage.put_bytes(key=key, content=content, content_type=facts.content_type)
        assert storage.object_metadata(key).size_bytes == facts.byte_size
        assert sha256(storage.read_bytes(key)).hexdigest() == facts.sha256
        with Session(engine) as db:
            assert object_from_row(db.get(StoredObject, identity)) == facts
            assert len(SEMANTIC_REFERENCES) == 9
            counts = [
                db.scalar(select(func.count()).select_from(c.table).where(c == identity))
                for c in SEMANTIC_REFERENCES
            ]
            assert counts == [0] * 8 + [1]
            assert db.get(StorageUsageAccount, 1).used_bytes == 0
        with engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE stored_object_retirements SET status='PENDING',next_attempt_at=:now,updated_at=:now WHERE retirement_uuid='legacy-delete' AND status='CANCELLED' AND attempt_count=1"
                ),
                {"now": utc_now()},
            )
        command.upgrade(config, "head")
        sessions = sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(worker, "SessionLocal", sessions)
        monkeypatch.setattr(worker, "object_storage", storage)
        with sessions() as db:
            operation = db.scalar(select(StoredObjectRetirement))
            fence = operation.deletion_fenced_at
            assert fence is not None and operation.attempt_count == 1
            assert snapshot(operation) == facts
            assert operation.completed_at == before["completed_at"]
            assert db.get(User, 1).avatar_object_id == identity

        # Even missing bytes cannot silently become reusable physical authority.
        storage.delete(key)
        with sessions() as db, pytest.raises(ValueError, match="deletion"):
            retain_for_reference(db, identity)
        storage.put_bytes(key=key, content=content, content_type=facts.content_type)
        assert (
            worker.execute_stored_object_retirement_task(None, "legacy-delete")["status"]
            == "failed"
        )
        assert storage.read_bytes(key) == content  # A live reference prevents automatic deletion.
        with sessions() as db:
            assert db.get(User, 1).avatar_object_id == identity
            assert db.get(StoredObject, identity) is not None
            assert db.get(StorageUsageAccount, 1).used_bytes == 0
            db.get(User, 1).avatar_object_id = None  # Explicit business-owner release.
            retire_after_release(db, identity)
            db.scalar(select(StoredObjectRetirement)).next_attempt_at = utc_now()
            db.commit()
        remove = storage.delete

        def failing_delete(key):
            raise OSError("temporary provider failure")

        monkeypatch.setattr(storage, "delete", failing_delete)
        assert (
            worker.execute_stored_object_retirement_task(None, "legacy-delete")["status"]
            == "failed"
        )
        with sessions() as db:
            operation = db.scalar(select(StoredObjectRetirement))
            assert operation.deletion_fenced_at == fence
            operation.next_attempt_at = utc_now()
            db.commit()
        monkeypatch.setattr(storage, "delete", remove)
        assert (
            worker.execute_stored_object_retirement_task(None, "legacy-delete")["status"]
            == "completed"
        )
        with sessions() as db:
            assert db.get(StoredObject, identity) is None
            operation = db.scalar(select(StoredObjectRetirement))
            assert operation.stored_object_id is None and snapshot(operation) == facts
            assert operation.deletion_fenced_at == fence and operation.attempt_count == 4
            assert db.get(StorageUsageAccount, 1).used_bytes == 0
