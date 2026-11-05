"""Lossless Practice scope coordinates at the durable Take contract boundary."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.modules.practice.score.time import MAX_JSON_SAFE_INTEGER


def migration():
    spec = spec_from_file_location(
        "practice_score_ticks",
        Path(__file__).parents[1] / "alembic/versions/0054_practice_score_ticks.py",
    )
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def old_tables(connection):
    metadata = sa.MetaData()
    for name in ("performance_takes", "performance_take_upload_reservations"):
        sa.Table(
            name,
            metadata,
            sa.Column("scope_start_beat", sa.Float(), nullable=False),
            sa.Column("scope_terminal_beat", sa.Float(), nullable=False),
        )
    metadata.create_all(connection)
    return metadata


def test_empty_development_storage_uses_lossless_integer_coordinates():
    with sa.create_engine("sqlite://").begin() as connection:
        old_tables(connection)
        with Operations.context(MigrationContext.configure(connection)):
            migration().upgrade()
        for name in ("performance_takes", "performance_take_upload_reservations"):
            table = sa.Table(name, sa.MetaData(), autoload_with=connection)
            assert set(table.c.keys()) == {"scope_start_tick", "scope_terminal_tick"}
            connection.execute(
                table.insert().values(
                    scope_start_tick=MAX_JSON_SAFE_INTEGER - 1,
                    scope_terminal_tick=MAX_JSON_SAFE_INTEGER,
                )
            )
            assert tuple(connection.execute(sa.select(table)).one()) == (
                MAX_JSON_SAFE_INTEGER - 1,
                MAX_JSON_SAFE_INTEGER,
            )


def test_gridless_coordinate_records_are_not_coerced():
    with sa.create_engine("sqlite://").begin() as connection:
        tables = old_tables(connection)
        connection.execute(
            tables.tables["performance_takes"]
            .insert()
            .values(scope_start_beat=1 / 3, scope_terminal_beat=1)
        )
        with Operations.context(MigrationContext.configure(connection)):
            with pytest.raises(RuntimeError, match="empty development"):
                migration().upgrade()
        assert "scope_start_beat" in {
            c["name"] for c in sa.inspect(connection).get_columns("performance_takes")
        }
