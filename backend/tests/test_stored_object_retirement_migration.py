"""Current PostgreSQL retirement schema and fail-closed pre-release admission."""

import pytest
import sqlalchemy as sa
from alembic import command
from app.db.models import User
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.performance_takes.manifest_persistence import manifest_to_row
from app.utils.timezone import utc_now_naive
from tests.test_take_manifest import value
from tests.test_practice_bundle_migration import migration_database, assert_current_bundle_schema


@pytest.mark.parametrize(
    "state", ["take_operation", "bundle_operation", "take_owner", "bundle_owner"]
)
def test_in_flight_deletion_requires_pre_release_recreation(monkeypatch, state):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0056_stored_object_authority")
        metadata = sa.MetaData()
        metadata.reflect(engine)
        tables = metadata.tables
        now = utc_now_naive()
        with engine.begin() as db:
            user = User(
                id=1, email="inflight@example.com", display_name="Owner", password_hash="test"
            )
            db.execute(tables["users"].insert().values(**user.model_dump()))
            if state.endswith("operation"):
                fields = dict(
                    status="PROCESSING",
                    attempt_count=1,
                    max_attempts=5,
                    outbox_uuid="inflight",
                    next_attempt_at=now,
                    created_at=now,
                    updated_at=now,
                )
                if state == "take_operation":
                    db.execute(
                        tables["performance_take_delete_outbox"]
                        .insert()
                        .values(
                            **fields,
                            take_uuid="take",
                            user_id=1,
                            object_key="take/object",
                            media_byte_size=1,
                        )
                    )
                else:
                    db.execute(
                        tables["practice_bundle_delete_outbox"]
                        .insert()
                        .values(
                            **fields,
                            bundle_id="bundle",
                            prepared_musicxml_object_key="notation",
                            artifact_object_key="artifact",
                        )
                    )
            else:
                for identity, key in [(1, "notation"), (2, "artifact")]:
                    obj = object_from_bytes(
                        object_key=key, content=b"bytes", content_type="application/octet-stream"
                    )
                    db.execute(
                        tables["stored_objects"]
                        .insert()
                        .values(id=identity, **obj.model_dump(exclude={"id"}))
                    )
                if state == "bundle_owner":
                    db.execute(
                        tables["practice_bundles"]
                        .insert()
                        .values(
                            bundle_id="bundle",
                            artifact_id="artifact",
                            artifact_schema_version=1,
                            prepared_musicxml_object_id=1,
                            artifact_object_id=2,
                            status="DELETING",
                            creation_expires_at=None,
                            created_at=now,
                        )
                    )
                else:
                    manifest = manifest_to_row(value())
                    db.execute(
                        tables["performance_take_manifests"]
                        .insert()
                        .values(id=1, **manifest.model_dump(exclude={"id"}))
                    )
                    db.execute(
                        tables["performance_takes"]
                        .insert()
                        .values(
                            manifest_id=1,
                            recording_object_id=1,
                            deletion_status="DELETING",
                            created_at=now,
                            updated_at=now,
                        )
                    )
        with pytest.raises(RuntimeError, match="recreate the pre-release environment"):
            command.upgrade(config, "head")
        assert "stored_object_retirements" not in sa.inspect(engine).get_table_names()


def test_upgrade_queues_unowned_objects_and_preserves_referenced_facts(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0056_stored_object_authority")
        metadata = sa.MetaData()
        metadata.reflect(engine)
        tables = metadata.tables
        with engine.begin() as db:
            obj = object_from_bytes(
                object_key="committed/unowned", content=b"", content_type="application/octet-stream"
            )
            db.execute(
                tables["stored_objects"].insert().values(id=1, **obj.model_dump(exclude={"id"}))
            )
            retained = object_from_bytes(
                object_key="committed/referenced", content=b"avatar", content_type="image/jpeg"
            )
            db.execute(
                tables["stored_objects"]
                .insert()
                .values(id=2, **retained.model_dump(exclude={"id"}))
            )
            user = User(
                id=1,
                email="retained@example.com",
                display_name="Owner",
                password_hash="test",
                avatar_object_id=2,
            )
            db.execute(tables["users"].insert().values(**user.model_dump()))
        command.upgrade(config, "head")
        assert_current_bundle_schema(engine)
        current = sa.MetaData()
        current.reflect(engine)
        with engine.connect() as db:
            operation = (
                db.execute(sa.select(current.tables["stored_object_retirements"])).mappings().one()
            )
            assert operation["stored_object_id"] == 1 and operation["status"] == "PENDING"
            assert operation["object_key"] == obj.object_key and operation["sha256"] == obj.sha256
            assert operation["byte_size"] == 0 and operation["content_type"] == obj.content_type
            assert db.scalar(sa.select(current.tables["users"].c.avatar_object_id)) == 2
            assert (
                db.scalar(
                    sa.select(current.tables["stored_objects"].c.sha256).where(
                        current.tables["stored_objects"].c.id == 2
                    )
                )
                == retained.sha256
            )
        retirement_fks = sa.inspect(engine).get_foreign_keys("stored_object_retirements")
        assert len(retirement_fks) == 1 and retirement_fks[0]["options"]["ondelete"] == "SET NULL"
