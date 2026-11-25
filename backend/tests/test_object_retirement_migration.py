"""Clean initialization and safe removal of runtime deletion-fence authority."""

import pytest
from sqlalchemy import text, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from alembic import command
from app.db.models import StoredObject, StoredObjectRetirement
from app.db.models.stored_object_retirement import StoredObjectRetirementStatus
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_objects.retirement import retire_after_release, snapshot
from app.shared.time import utc_now
from app.worker.execution import stored_object_retirement as worker
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.postgres_schema import postgres_schema_database


def test_clean_chain_initializes_fence_without_runtime_operations(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        for revision in ["0001_current_schema", "0002_storage_quota", "head"]:
            command.upgrade(config, revision)
            with engine.connect() as connection:
                assert (
                    connection.scalar(text("SELECT count(*) FROM stored_object_retirements")) == 0
                )
        with engine.connect() as connection:
            assert connection.execute(
                text(
                    "SELECT plan_code, default_limit_bytes FROM storage_plan_policies ORDER BY plan_code"
                )
            ).all() == [("FREE", 104857600), ("PLUS", 5368709120), ("PRO", 21474836480)]
            for table in [
                "users",
                "user_storage_entitlements",
                "storage_usage_accounts",
                "storage_usage_counters",
                "storage_quota_holds",
                "stored_objects",
            ]:
                assert connection.scalar(text(f'SELECT count(*) FROM "{table}"')) == 0
        column = next(
            c
            for c in inspect(engine).get_columns("stored_object_retirements")
            if c["name"] == "deletion_fenced_at"
        )
        assert column["nullable"] and column["type"].timezone
        assert "ck_object_retirement_deletion_fence" in {
            c["name"] for c in inspect(engine).get_check_constraints("stored_object_retirements")
        }
        command.downgrade(config, "0002_storage_quota")
        assert "deletion_fenced_at" not in {
            c["name"] for c in inspect(engine).get_columns("stored_object_retirements")
        }
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM stored_object_retirements")) == 0


def test_downgrade_requires_unfinished_runtime_fence_to_complete(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        storage = InMemoryObjectStorage()
        key, content = "immutable/runtime-object", b"verified bytes"
        storage.put_bytes(key=key, content=content, content_type="application/octet-stream")
        sessions = sessionmaker(engine, expire_on_commit=False)
        with sessions() as db:
            obj = object_from_bytes(
                object_key=key, content=content, content_type="application/octet-stream"
            )
            db.add(obj)
            db.flush()
            identity = obj.id
            uuid = retire_after_release(db, identity)[0]
            operation = db.scalar(select(StoredObjectRetirement))
            operation.deletion_fenced_at = utc_now()
            operation.status = StoredObjectRetirementStatus.FAILED
            operation.attempt_count = 1
            facts, fence = snapshot(operation), operation.deletion_fenced_at
            db.commit()
        with pytest.raises(RuntimeError, match="must complete"):
            command.downgrade(config, "0002_storage_quota")
        with sessions() as db:
            assert (
                db.scalar(text("SELECT version_num FROM alembic_version"))
                == "0007_mail_source_lifecycle"
            )
            assert db.scalar(select(StoredObjectRetirement)).deletion_fenced_at == fence
            assert db.get(StoredObject, identity) is not None
        monkeypatch.setattr(worker, "SessionLocal", sessions)
        monkeypatch.setattr(worker, "object_storage", storage)
        assert worker.execute_stored_object_retirement_task(None, uuid)["status"] == "completed"
        assert not storage.exists(key)
        with sessions() as db:
            operation = db.scalar(select(StoredObjectRetirement))
            assert snapshot(operation) == facts and operation.stored_object_id is None
        command.downgrade(config, "0002_storage_quota")
        command.upgrade(config, "head")
        with Session(engine) as db:
            operation = db.scalar(select(StoredObjectRetirement))
            assert operation.status == StoredObjectRetirementStatus.COMPLETED
            assert snapshot(operation) == facts and operation.stored_object_id is None
