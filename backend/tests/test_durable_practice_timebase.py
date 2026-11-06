"""Complete, bounded source-local score coordinates in durable playback planning snapshots."""

from fractions import Fraction
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import ValidationError
from app.modules.performance_takes.schemas import (
    PerformanceTakeScoreTimebase,
    PerformanceTakeTempoPlan,
    PerformanceTakeResolvedFullScope,
)

MAX_SAFE = 2**53 - 1
TABLES = ("performance_take_manifests",)
INVALID = [
    {"ticks_per_quarter": 0},
    {"ticks_per_quarter": -1},
    {"ticks_per_quarter": MAX_SAFE + 1},
    {"scope_start_tick": -1},
    {"scope_start_tick": MAX_SAFE + 1},
    {"scope_terminal_tick": 0},
    {"scope_terminal_tick": -1},
    {"scope_terminal_tick": MAX_SAFE + 1},
    {"scope_start_tick": 114, "scope_terminal_tick": 113},
]


def migration():
    spec = spec_from_file_location(
        "take_score_timebase",
        Path(__file__).parents[1] / "alembic/versions/0055_performance_take_score_timebase.py",
    )
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def coordinate_db():
    with sa.create_engine("sqlite://").begin() as connection:
        metadata = sa.MetaData()
        for name in TABLES:
            sa.Table(
                name,
                metadata,
                sa.Column("scope_start_tick", sa.BigInteger(), nullable=False),
                sa.Column("scope_terminal_tick", sa.BigInteger(), nullable=False),
            )
        metadata.create_all(connection)
        yield connection, metadata


def upgrade(connection):
    with Operations.context(MigrationContext.configure(connection)):
        migration().upgrade()


@pytest.mark.parametrize("table_name", TABLES)
def test_migration_preserves_exact_timebase_and_enforces_every_coordinate_bound(
    coordinate_db, table_name
):
    connection, _ = coordinate_db
    upgrade(connection)
    table = sa.Table(table_name, sa.MetaData(), autoload_with=connection)
    valid = dict(ticks_per_quarter=60, scope_start_tick=30, scope_terminal_tick=113)
    connection.execute(table.insert().values(**valid))
    row = connection.execute(sa.select(table)).mappings().one()
    assert Fraction(row["scope_start_tick"], row["ticks_per_quarter"]) == Fraction(1, 2)
    assert Fraction(row["scope_terminal_tick"], row["ticks_per_quarter"]) == Fraction(113, 60)
    for invalid in INVALID:
        with pytest.raises(sa.exc.IntegrityError, match="CHECK constraint failed"):
            with connection.begin_nested():
                connection.execute(table.insert().values(**(valid | invalid)))
    with pytest.raises(sa.exc.IntegrityError):
        with connection.begin_nested():
            connection.execute(table.insert().values(scope_start_tick=30, scope_terminal_tick=113))


@pytest.mark.parametrize("table_name", TABLES)
def test_migration_refuses_nonempty_records_before_changing_either_table(coordinate_db, table_name):
    connection, metadata = coordinate_db
    connection.execute(
        metadata.tables[table_name].insert().values(scope_start_tick=30, scope_terminal_tick=113)
    )
    with pytest.raises(RuntimeError, match="empty development"):
        upgrade(connection)
    for name in TABLES:
        assert "ticks_per_quarter" not in {
            c["name"] for c in sa.inspect(connection).get_columns(name)
        }


@pytest.mark.parametrize("value", [0, -1, True, 1.0, MAX_SAFE + 1])
def test_score_timebase_transport_requires_positive_safe_integer(value):
    with pytest.raises(ValidationError):
        PerformanceTakeScoreTimebase(ticks_per_quarter=value)


def test_complete_snapshot_validation_is_source_independent():
    grid = PerformanceTakeScoreTimebase(ticks_per_quarter=60)
    scope = PerformanceTakeResolvedFullScope(kind="FULL", start_tick=30, terminal_tick=120)
    tempo = PerformanceTakeTempoPlan.model_validate(
        {
            "selection": {"mode": "SCORE"},
            "segments": [
                {"startTick": 0, "bpm": 80, "source": "PRODUCT_DEFAULT"},
                {"startTick": 113, "bpm": 100, "source": "MUSICXML"},
            ],
        }
    )
    assert Fraction(scope.start_tick, grid.ticks_per_quarter) == Fraction(1, 2)
    assert Fraction(tempo.segments[-1].startTick, grid.ticks_per_quarter) == Fraction(113, 60)
    for tick in [-1, 1.5, MAX_SAFE + 1]:
        with pytest.raises(ValidationError):
            PerformanceTakeTempoPlan.model_validate(
                {
                    "selection": {"mode": "SCORE"},
                    "segments": [{"startTick": tick, "bpm": 100, "source": "MUSICXML"}],
                }
            )
    with pytest.raises(ValidationError):
        PerformanceTakeResolvedFullScope(kind="FULL", start_tick=31, terminal_tick=30)


def test_client_cannot_choose_durable_score_timebase():
    from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest

    payload = {
        "client_request_id": "request",
        "practice_binding": {"score_id": "score", "revision_id": "revision", "bundle_id": "bundle"},
        "media": {"kind": "AUDIO", "byte_size": 1, "mime_type": "audio/webm"},
        "scope": {"kind": "FULL"},
        "tempo_selection": {"mode": "SCORE"},
        "recording_timebase": {
            "nominalMediaDurationUs": 1000000,
            "activeSegments": [
                {
                    "performanceStartUs": 0,
                    "performanceEndUs": 1000000,
                    "mediaStartUs": 0,
                    "mediaEndUs": 1000000,
                }
            ],
        },
    }
    for field, value in [("ticks_per_quarter", 60), ("score_timebase", {"ticks_per_quarter": 60})]:
        with pytest.raises(ValidationError):
            PerformanceTakeUploadReservationRequest.model_validate(payload | {field: value})


def test_empty_score_grid_migration_round_trip(coordinate_db):
    connection, _ = coordinate_db
    upgrade(connection)
    with Operations.context(MigrationContext.configure(connection)):
        migration().downgrade()
    for name in TABLES:
        assert {c["name"] for c in sa.inspect(connection).get_columns(name)} == {
            "scope_start_tick",
            "scope_terminal_tick",
        }
