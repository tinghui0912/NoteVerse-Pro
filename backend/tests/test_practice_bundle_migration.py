"""PostgreSQL upgrade and current durable Bundle model agreement."""

from app.db.models import StoredObject

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

from app.db.models import User, Score, ScoreRevision, ScoreRevisionPracticeBinding
from app.db.models.score import RevisionOrigin


@contextmanager
def migration_database(monkeypatch):
    raw_url = os.environ.get("NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL")
    if not raw_url:
        pytest.skip(
            "Set NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL for PostgreSQL migration validation"
        )
    url = make_url(raw_url).set(drivername="postgresql+psycopg")
    assert (url.database or "").startswith("noteverse_test_")
    schema = "practice_bundle_migration_" + uuid4().hex
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


def assert_current_bundle_schema(engine):
    inspector = sa.inspect(engine)
    for name in [
        "practice_bundles",
        "score_revision_practice_bindings",
        "practice_bundle_delete_outbox",
        "stored_objects",
        "uploads",
        "import_artifacts",
        "score_revision_sources",
        "score_render_assets",
        "score_playback_assets",
        "users",
        "performance_take_manifests",
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
            matching = [
                actual
                for actual in actual_fks.values()
                if actual["constrained_columns"] == [element.parent.name for element in fk.elements]
            ]
            assert len(matching) == 1
            assert matching[0]["referred_table"] == next(iter(fk.elements)).column.table.name
            assert matching[0]["referred_columns"] == [
                element.column.name for element in fk.elements
            ]
            assert matching[0]["options"].get("ondelete") == fk.ondelete
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
    from app.db.models import PracticeBundleRecord

    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        assert_current_bundle_schema(engine)
        inspector = sa.inspect(engine)
        assert set(inspector.get_table_names()) == set(SQLModel.metadata.tables) | {
            "alembic_version"
        }
        for name in (
            "score_memberships",
            "score_guest_preview_grants",
            "score_invites",
        ):
            table = SQLModel.metadata.tables[name]
            assert {column["name"] for column in inspector.get_columns(name)} == set(
                table.columns.keys()
            )
        for name, targets in {
            "performance_take_manifests": {"users"},
            "performance_takes": {"scores", "performance_take_manifests", "stored_objects"},
            "performance_take_upload_reservations": {"users", "performance_take_manifests"},
        }.items():
            assert {fk["referred_table"] for fk in inspector.get_foreign_keys(name)} == targets
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
                content_hash="d04b98f48e8f8bcc15c6ae5ac050801cd6dcfd428fb5f9e65c4e16e7807340fa",
                origin=RevisionOrigin.OMR,
                created_by_user_id=user.id,
            )
            db.add(revision)
            db.flush()
            source = PracticeBundleRecord(
                bundle_id="source",
                artifact_id="artifact",
                artifact_schema_version=1,
                prepared_musicxml_object=StoredObject(
                    object_key="xml",
                    sha256="a" * 64,
                    byte_size=10,
                    content_type="application/vnd.recordare.musicxml+xml",
                ),
                artifact_object=StoredObject(
                    object_key="json",
                    sha256="b" * 64,
                    byte_size=10,
                    content_type="application/json",
                ),
                status="READY",
            )
            db.add(source)
            db.flush()
            db.add(ScoreRevisionPracticeBinding(revision_id=revision.id, bundle_id=source.id))
            db.commit()
            db.delete(revision)
            db.commit()
            db.refresh(source)
            assert db.get(ScoreRevisionPracticeBinding, revision.id) is None
