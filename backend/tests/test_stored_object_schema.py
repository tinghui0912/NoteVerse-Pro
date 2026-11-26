"""Every semantic StoredObject reference has a PostgreSQL lookup path."""

import sqlalchemy as sa
from alembic import command
from app.modules.media_storage.references import SEMANTIC_REFERENCES
from tests.support.postgres_schema import postgres_schema_database


def assert_reference_lookup_paths(engine):
    inspector = sa.inspect(engine)
    for column in SEMANTIC_REFERENCES:
        indexes = inspector.get_indexes(column.table.name)
        constraints = inspector.get_unique_constraints(column.table.name)
        assert any(
            index["column_names"][0] == column.name
            and index.get("dialect_options", {}).get("postgresql_where") is None
            for index in indexes
        ) or any(constraint["column_names"] == [column.name] for constraint in constraints), (
            f"{column.table.name}.{column.name} needs a physical leading-column index"
        )
    avatar_index = next(
        index
        for index in inspector.get_indexes("users")
        if index["name"] == "ix_users_avatar_object_id"
    )
    assert avatar_index["column_names"] == ["avatar_object_id"]
    assert not avatar_index["unique"]
    assert not any(
        constraint["column_names"] == ["avatar_object_id"]
        for constraint in inspector.get_unique_constraints("users")
    )
    avatar_column = next(
        column for column in inspector.get_columns("users") if column["name"] == "avatar_object_id"
    )
    assert avatar_column["nullable"]
    avatar_fk = next(
        fk
        for fk in inspector.get_foreign_keys("users")
        if fk["constrained_columns"] == ["avatar_object_id"]
    )
    assert avatar_fk["referred_table"] == "stored_objects"
    assert avatar_fk["referred_columns"] == ["id"]
    assert avatar_fk["options"]["ondelete"] == "RESTRICT"


def test_fresh_schema_reference_lookup_paths(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        assert_reference_lookup_paths(engine)


def test_physical_facts_restrict_and_retirement_set_null(monkeypatch):
    import pytest
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import IntegrityError
    from app.db.models import StoredObject, StoredObjectRetirement, User

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        for column in SEMANTIC_REFERENCES:
            fk = next(
                fk
                for fk in inspector.get_foreign_keys(column.table.name)
                if fk["constrained_columns"] == [column.name]
            )
            assert fk["referred_table"] == "stored_objects"
            assert fk["options"]["ondelete"] == "RESTRICT"
        with Session(engine) as db:
            obj = StoredObject(
                object_key="physical/one",
                byte_size=0,
                sha256="a" * 64,
                content_type="application/octet-stream",
            )
            duplicate_sha = StoredObject(
                object_key="physical/two",
                byte_size=0,
                sha256="a" * 64,
                content_type="application/octet-stream",
            )
            db.add_all([obj, duplicate_sha])
            db.flush()
            user = User(
                email="reference@example.com",
                display_name="Reference",
                password_hash="test",
                avatar_object_id=obj.id,
            )
            operation = StoredObjectRetirement(
                stored_object_id=obj.id,
                object_key=obj.object_key,
                byte_size=obj.byte_size,
                sha256=obj.sha256,
                content_type=obj.content_type,
            )
            db.add_all([user, operation])
            db.commit()
            with pytest.raises(IntegrityError) as error:
                db.execute(sa.delete(StoredObject).where(StoredObject.id == obj.id))
                db.commit()
            assert error.value.orig.sqlstate == "23503"
            db.rollback()
            user.avatar_object_id = None
            db.commit()
            db.execute(sa.delete(StoredObject).where(StoredObject.id == obj.id))
            db.commit()
            db.refresh(operation)
            assert operation.stored_object_id is None
            for patch in [
                {"object_key": "physical/two"},
                {"byte_size": -1},
                {"sha256": "A" * 64},
                {"sha256": "a" * 63},
                {"object_key": " "},
                {"content_type": " "},
            ]:
                with pytest.raises(IntegrityError):
                    db.add(
                        StoredObject(
                            **(
                                {
                                    "object_key": "physical/new",
                                    "byte_size": 0,
                                    "sha256": "a" * 64,
                                    "content_type": "application/octet-stream",
                                }
                                | patch
                            )
                        )
                    )
                    db.commit()
                db.rollback()


def test_explicit_reference_registry_covers_every_stored_object_fk():
    from sqlmodel import SQLModel
    import app.db.models  # noqa: F401
    from app.db.models.stored_object_retirement import StoredObjectRetirement

    semantic = {(column.table.name, column.name) for column in SEMANTIC_REFERENCES}
    assert len(semantic) == len(SEMANTIC_REFERENCES)
    # This FK preserves delivery evidence and intentionally releases its pointer on deletion.
    evidence = {(StoredObjectRetirement.__tablename__, "stored_object_id")}
    actual = {}
    for table in SQLModel.metadata.tables.values():
        for fk in table.foreign_keys:
            if fk.target_fullname == "stored_objects.id":
                actual[(table.name, fk.parent.name)] = fk.ondelete
    assert set(actual) == semantic | evidence
    assert all(actual[identity] == "RESTRICT" for identity in semantic)
    assert all(actual[identity] == "SET NULL" for identity in evidence)
