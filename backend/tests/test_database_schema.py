"""The standalone Alembic baseline agrees with the complete application metadata."""

import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlmodel import SQLModel

from tests.support.postgres_schema import postgres_schema_database


def enum_contract():
    enums = {}
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            kind = column.type
            if isinstance(kind, sa.Enum) and kind.native_enum:
                assert kind.name not in enums or enums[kind.name] == kind.enums
                enums[kind.name] = kind.enums
    return enums


def database_enums(connection):
    return dict(
        connection.execute(
            sa.text("""
        SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        JOIN pg_enum e ON e.enumtypid=t.oid
        WHERE n.nspname=current_schema() GROUP BY t.typname
    """)
        ).all()
    )


def foreign_key_signature(columns, target, referred, options):
    return (
        tuple(columns),
        target,
        tuple(referred),
        options.get("ondelete"),
        options.get("onupdate"),
        options.get("deferrable"),
        options.get("initially"),
    )


def assert_schema_parity(engine):
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        assert set(inspector.get_table_names()) == set(SQLModel.metadata.tables) | {
            "alembic_version"
        }
        # No table/type/column/default/index/FK drift is filtered. Alembic owns
        # the comparison and understands its version table and PostgreSQL SERIAL.
        context = MigrationContext.configure(
            connection,
            opts={
                "target_metadata": SQLModel.metadata,
                "compare_type": True,
                "compare_server_default": True,
            },
        )
        assert compare_metadata(context, SQLModel.metadata) == []
        assert database_enums(connection) == enum_contract()
        for table in SQLModel.metadata.tables.values():
            actual = {c["name"]: c for c in inspector.get_columns(table.name)}
            assert set(actual) == set(table.c.keys())
            assert {name: col["nullable"] for name, col in actual.items()} == {
                c.name: c.nullable for c in table.c
            }
            assert inspector.get_pk_constraint(table.name)["constrained_columns"] == [
                c.name for c in table.primary_key
            ]
            fks = inspector.get_foreign_keys(table.name)
            expected_fks = {
                foreign_key_signature(
                    [e.parent.name for e in fk.elements],
                    next(iter(fk.elements)).column.table.name,
                    [e.column.name for e in fk.elements],
                    {
                        "ondelete": fk.ondelete,
                        "onupdate": fk.onupdate,
                        "deferrable": fk.deferrable,
                        "initially": fk.initially,
                    },
                )
                for fk in table.foreign_key_constraints
            }
            assert {
                foreign_key_signature(
                    fk["constrained_columns"],
                    fk["referred_table"],
                    fk["referred_columns"],
                    fk["options"],
                )
                for fk in fks
            } == expected_fks
            assert {fk.name for fk in table.foreign_key_constraints if fk.name} <= {
                fk["name"] for fk in fks
            }
            uniques = inspector.get_unique_constraints(table.name)
            expected_unique = [c for c in table.constraints if isinstance(c, sa.UniqueConstraint)]
            assert {tuple(c["column_names"]) for c in uniques} == {
                tuple(col.name for col in c.columns) for c in expected_unique
            }
            assert {c.name for c in expected_unique if c.name} <= {c["name"] for c in uniques}
            checks = {c["name"]: c["sqltext"] for c in inspector.get_check_constraints(table.name)}
            expected_checks = [c for c in table.constraints if isinstance(c, sa.CheckConstraint)]
            assert set(checks) == {c.name for c in expected_checks}
            indexes = {
                i["name"]: i
                for i in inspector.get_indexes(table.name)
                if not i.get("duplicates_constraint")
            }
            assert set(indexes) == {i.name for i in table.indexes}
            # PostgreSQL canonicalizes casts, parentheses and IN expressions.
            # Parse the metadata expressions on a LIKE shadow table so its own
            # deparser compares exact semantics instead of ignoring CHECKs or
            # partial predicates based on their textual spelling.
            shadow = "parity_shadow"
            connection.exec_driver_sql(f'CREATE TEMP TABLE {shadow} (LIKE "{table.name}")')
            for check in expected_checks:
                connection.exec_driver_sql(
                    f"ALTER TABLE {shadow} ADD CONSTRAINT expected_check CHECK ({check.sqltext.compile(dialect=connection.dialect, compile_kwargs={'literal_binds': True, 'include_table': False})})"
                )
                parsed = connection.scalar(
                    sa.text(
                        "SELECT pg_get_expr(conbin, conrelid) FROM pg_constraint WHERE conrelid='pg_temp.parity_shadow'::regclass AND conname='expected_check'"
                    )
                )
                actual_expression = connection.scalar(
                    sa.text(
                        "SELECT pg_get_expr(conbin, conrelid) FROM pg_constraint WHERE conrelid=CAST(:table AS regclass) AND conname=:name"
                    ),
                    {"table": table.name, "name": check.name},
                )
                assert actual_expression == parsed, (table.name, check.name)
                connection.exec_driver_sql(f"ALTER TABLE {shadow} DROP CONSTRAINT expected_check")
            shadow_table = sa.Table(
                shadow, sa.MetaData(), *[sa.Column(c.name, c.type) for c in table.c]
            )
            for index in table.indexes:
                observed = indexes[index.name]
                assert observed["column_names"] == [c.name for c in index.columns]
                assert observed["unique"] == bool(index.unique)
                expected = sa.Index(
                    "expected_index",
                    *[shadow_table.c[c.name] for c in index.columns],
                    unique=index.unique,
                    **dict(index.dialect_kwargs),
                )
                expected.create(connection)
                parsed = connection.scalar(
                    sa.text(
                        "SELECT pg_get_expr(indpred, indrelid) FROM pg_index WHERE indexrelid='pg_temp.expected_index'::regclass"
                    )
                )
                actual_predicate = connection.scalar(
                    sa.text(
                        "SELECT pg_get_expr(indpred, indrelid) FROM pg_index WHERE indexrelid=CAST(:name AS regclass)"
                    ),
                    {"name": index.name},
                )
                assert actual_predicate == parsed, (table.name, index.name)
                expected.drop(connection)
            connection.exec_driver_sql(f"DROP TABLE {shadow}")
        version = inspector.get_columns("alembic_version")[0]
        assert version["type"].length == 128


def assert_bootstrap(engine):
    with engine.connect() as connection:
        assert connection.execute(
            sa.text("SELECT plan_code, default_limit_bytes FROM storage_plan_policies")
        ).all() == [("FREE", 104857600)]
        # Bootstrap includes reference data only, not users or operational history.
        for table in SQLModel.metadata.tables:
            if table not in {"storage_plan_policies"}:
                assert connection.scalar(sa.text(f'SELECT count(*) FROM "{table}"')) == 0


def test_baseline_upgrade_parity_bootstrap_teardown_and_reupgrade(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        script = ScriptDirectory.from_config(config)
        revisions = list(script.walk_revisions())
        assert script.get_heads() == ["0002_storage_quota"]
        assert script.get_bases() == ["0001_current_schema"]
        assert len(revisions) == 2
        assert revisions[0].down_revision == revisions[1].revision
        for _ in range(2):
            command.upgrade(config, "head")
            assert_schema_parity(engine)
            assert_bootstrap(engine)
            command.downgrade(config, "base")
            with engine.connect() as connection:
                assert sa.inspect(connection).get_table_names() == ["alembic_version"]
                assert connection.scalar(sa.text("SELECT count(*) FROM alembic_version")) == 0
                assert database_enums(connection) == {}
