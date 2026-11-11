"""0059 preserves READY authority and admits only honest null-FK creation leases."""

import pytest
import sqlalchemy as sa
from alembic import command
from app.db.models import ObjectWriteIntent
from tests.test_practice_bundle_migration import migration_database, assert_current_bundle_schema
from app.utils.timezone import utc_now_naive


def seed_bundle(engine, status):
    metadata = sa.MetaData()
    metadata.reflect(engine)
    now = utc_now_naive()
    with engine.begin() as db:
        for identity in (1, 2):
            db.execute(
                metadata.tables["stored_objects"]
                .insert()
                .values(
                    id=identity,
                    object_key=f"bundle/{identity}",
                    byte_size=1,
                    sha256="a" * 64,
                    content_type="application/xml",
                    created_at=now,
                )
            )
        db.execute(
            metadata.tables["practice_bundles"]
            .insert()
            .values(
                id=1,
                bundle_id="bundle",
                artifact_id="artifact",
                artifact_schema_version=1,
                status=status,
                creation_expires_at=now if status == "CREATING" else None,
                prepared_musicxml_object_id=1,
                artifact_object_id=2,
                created_at=now,
            )
        )


def test_creating_bundle_migration_fails_before_ddl(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0058_stored_object_reference_indexes")
        seed_bundle(engine, "CREATING")
        with pytest.raises(RuntimeError, match="CREATING Bundle.*recreation"):
            command.upgrade(config, "head")
        assert "object_write_intents" not in sa.inspect(engine).get_table_names()


def test_ready_bundle_and_new_write_schema_match_current_models(monkeypatch):
    from sqlalchemy.exc import IntegrityError

    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0058_stored_object_reference_indexes")
        seed_bundle(engine, "READY")
        command.upgrade(config, "head")
        assert_current_bundle_schema(engine)
        metadata = sa.MetaData()
        metadata.reflect(engine)
        table = metadata.tables["practice_bundles"]
        with engine.connect() as db:
            row = db.execute(sa.select(table)).mappings().one()
            assert (
                row["prepared_musicxml_object_id"],
                row["artifact_object_id"],
                row["status"],
            ) == (1, 2, "READY")
        inspector = sa.inspect(engine)
        expected = ObjectWriteIntent.__table__
        assert {col["name"] for col in inspector.get_columns(expected.name)} == set(
            expected.columns.keys()
        )
        assert any(
            c["column_names"] == ["object_key"]
            for c in inspector.get_unique_constraints(expected.name)
        )
        assert inspector.get_foreign_keys(expected.name) == []
        for status, expires, prepared, artifact in [
            ("CREATING", utc_now_naive(), None, None),
            ("READY", None, 1, 2),
        ]:
            with engine.begin() as db:
                db.execute(
                    table.insert().values(
                        id=2,
                        bundle_id="valid-" + status,
                        artifact_id="a",
                        artifact_schema_version=1,
                        status=status,
                        creation_expires_at=expires,
                        prepared_musicxml_object_id=prepared,
                        artifact_object_id=artifact,
                        created_at=utc_now_naive(),
                    )
                ) if status == "CREATING" else None
        for status, expires, prepared, artifact in [
            ("CREATING", utc_now_naive(), 1, 2),
            ("READY", None, None, None),
            ("CREATING", None, None, None),
        ]:
            with pytest.raises(IntegrityError), engine.begin() as db:
                db.execute(
                    table.insert().values(
                        id=3,
                        bundle_id="bad",
                        artifact_id="a",
                        artifact_schema_version=1,
                        status=status,
                        creation_expires_at=expires,
                        prepared_musicxml_object_id=prepared,
                        artifact_object_id=artifact,
                        created_at=utc_now_naive(),
                    )
                )
