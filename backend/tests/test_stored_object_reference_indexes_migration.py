"""PostgreSQL semantic-reference indexes agree with the current ownership schema."""

import pytest
import sqlalchemy as sa
from alembic import command

from app.modules.storage_objects.references import SEMANTIC_REFERENCES
from tests.test_practice_bundle_migration import (
    assert_current_bundle_schema,
    migration_database,
)


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


@pytest.mark.parametrize("starting_revision", ["base", "0057_stored_object_retirement"])
def test_reference_indexes_upgrade_downgrade_and_fresh_schema(monkeypatch, starting_revision):
    with migration_database(monkeypatch) as (engine, config):
        if starting_revision != "base":
            command.upgrade(config, starting_revision)
            assert "ix_users_avatar_object_id" not in {
                index["name"] for index in sa.inspect(engine).get_indexes("users")
            }
        command.upgrade(config, "head")
        assert_reference_lookup_paths(engine)
        assert_current_bundle_schema(engine)
        command.downgrade(config, "0057_stored_object_retirement")
        assert "ix_users_avatar_object_id" not in {
            index["name"] for index in sa.inspect(engine).get_indexes("users")
        }
        command.upgrade(config, "head")
        assert_reference_lookup_paths(engine)
        assert_current_bundle_schema(engine)
