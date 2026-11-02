"""PostgreSQL upgrade and current durable source model agreement."""

from contextlib import contextmanager
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from alembic import command
from alembic.config import Config
from sqlmodel import SQLModel

from app.db.models import User, Score, ScoreRevision
from app.db.models.score import RevisionOrigin


@contextmanager
def migration_database(monkeypatch):
    raw_url = os.environ.get("NOTEVERSE_TEST_PRACTICE_SOURCE_POSTGRES_URL")
    if not raw_url:
        pytest.skip(
            "Set NOTEVERSE_TEST_PRACTICE_SOURCE_POSTGRES_URL for PostgreSQL migration validation"
        )
    url = make_url(raw_url).set(drivername="postgresql+psycopg")
    assert (url.database or "").startswith("noteverse_test_")
    schema = "practice_source_migration_" + uuid4().hex
    admin = sa.create_engine(url)
    with admin.begin() as connection:
        connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    monkeypatch.setenv("PGOPTIONS", f"-csearch_path={schema}")
    engine = sa.create_engine(url)
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    config.set_main_option(
        "sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%")
    )
    try:
        yield engine, config
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def assert_current_source_schema(engine):
    inspector = sa.inspect(engine)
    for name in [
        "practice_sources",
        "practice_source_delete_outbox",
        "performance_takes",
        "performance_take_upload_reservations",
    ]:
        expected = SQLModel.metadata.tables[name]
        columns = {column["name"]: column for column in inspector.get_columns(name)}
        assert set(columns) == set(expected.columns.keys())
        for column in expected.columns:
            assert columns[column.name]["nullable"] == column.nullable
        actual_fks = {fk["name"]: fk for fk in inspector.get_foreign_keys(name)}
        for fk in expected.foreign_key_constraints:
            if fk.name:
                assert fk.name in actual_fks
                assert (
                    actual_fks[fk.name]["referred_table"]
                    == next(iter(fk.elements)).column.table.name
                )
                assert actual_fks[fk.name]["options"].get("ondelete") == fk.ondelete
        indexes = {item["name"]: item for item in inspector.get_indexes(name)}
        for index in expected.indexes:
            assert index.name in indexes
            assert indexes[index.name]["column_names"] == [column.name for column in index.columns]
        constraints = {item["name"] for item in inspector.get_check_constraints(name)}
        constraints |= {item["name"] for item in inspector.get_unique_constraints(name)}
        for constraint in expected.constraints:
            if (
                isinstance(constraint, (sa.UniqueConstraint, sa.CheckConstraint))
                and constraint.name
            ):
                assert constraint.name in constraints


def test_fresh_foundation_schema_matches_models_and_revision_ownership(monkeypatch):
    from sqlalchemy.orm import Session
    from app.db.models import PracticeSourceRecord

    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        assert_current_source_schema(engine)
        inspector = sa.inspect(engine)
        assert set(inspector.get_table_names()) == set(SQLModel.metadata.tables) | {
            "alembic_version"
        }
        for name in (
            "score_memberships",
            "score_share_grants",
            "score_invites",
            "share_grant_redemptions",
        ):
            table = SQLModel.metadata.tables[name]
            assert {column["name"] for column in inspector.get_columns(name)} == set(
                table.columns.keys()
            )
        for name in ("performance_takes", "performance_take_upload_reservations"):
            table = SQLModel.metadata.tables[name]
            provenance = {
                "source_id",
                "source_score_uuid",
                "source_revision_uuid",
                "source_artifact_id",
                "score_title_snapshot",
            }
            assert provenance <= set(table.columns.keys())
            assert all(not table.c[column].nullable for column in provenance)
            targets = {fk["referred_table"] for fk in inspector.get_foreign_keys(name)}
            assert targets == (
                {"users", "scores", "performance_take_upload_reservations"}
                if name == "performance_takes"
                else {"users", "scores"}
            )
        with Session(engine) as db:
            user = User(email="schema@example.com", display_name="Schema", password_hash="test")
            db.add(user)
            db.flush()
            score = Score(score_uuid="score", title="Score", owner_user_id=user.id)
            db.add(score)
            db.flush()
            revision = ScoreRevision(
                revision_uuid="revision",
                score_id=score.id,
                revision_number=1,
                content_hash="hash",
                origin=RevisionOrigin.OMR,
                created_by_user_id=user.id,
            )
            db.add(revision)
            db.flush()
            source = PracticeSourceRecord(
                live_revision_id=revision.id,
                source_id="source",
                source_score_uuid="score",
                source_revision_uuid="revision",
                artifact_id="artifact",
                artifact_schema_version=1,
                prepared_musicxml_object_key="xml",
                prepared_musicxml_sha256="a" * 64,
                prepared_musicxml_byte_size=10,
                artifact_object_key="json",
                artifact_sha256="b" * 64,
                artifact_byte_size=10,
                status="READY",
            )
            db.add(source)
            db.commit()
            db.delete(revision)
            db.commit()
            db.refresh(source)
            assert source.live_revision_id is None
            assert source.source_revision_uuid == "revision"
