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
from app.utils.timezone import utc_now_naive


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
            if name in {"performance_takes", "performance_take_upload_reservations"} and [
                column.name for column in index.columns
            ] not in (["practice_source_id"], ["linked_score_id"]):
                continue
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


def test_upgrade_retains_canonical_identity_and_backfills_live_owner(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0054_take_upload_reservations")
        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=engine)
        scores = sa.Table("scores", metadata, autoload_with=engine)
        revisions = sa.Table("score_revisions", metadata, autoload_with=engine)
        sources = sa.Table("practice_source_snapshots", metadata, autoload_with=engine)
        outboxes = sa.Table(
            "practice_source_snapshot_delete_outbox", metadata, autoload_with=engine
        )
        now = utc_now_naive()
        with engine.begin() as connection:
            user_id = connection.execute(
                users.insert()
                .values(
                    **User(
                        email="migration@example.com",
                        display_name="Migration",
                        password_hash="test",
                    ).model_dump(exclude={"id"})
                )
                .returning(users.c.id)
            ).scalar_one()
            score_id = connection.execute(
                scores.insert()
                .values(
                    **Score(
                        score_uuid="source-score", owner_user_id=user_id, title="Source"
                    ).model_dump(exclude={"id"})
                )
                .returning(scores.c.id)
            ).scalar_one()
            revision_id = connection.execute(
                revisions.insert()
                .values(
                    **ScoreRevision(
                        revision_uuid="source-revision",
                        score_id=score_id,
                        revision_number=1,
                        content_hash="content",
                        origin=RevisionOrigin.OMR,
                        created_by_user_id=user_id,
                    ).model_dump(exclude={"id"})
                )
                .returning(revisions.c.id)
            ).scalar_one()
            values = dict(
                source_score_uuid="source-score",
                artifact_id="artifact",
                artifact_schema_version=1,
                prepared_musicxml_sha256="a" * 64,
                prepared_musicxml_byte_size=10,
                artifact_sha256="b" * 64,
                artifact_byte_size=20,
                created_at=now,
            )
            live_id = connection.execute(
                sources.insert()
                .values(
                    **values,
                    snapshot_uuid=str(uuid4()),
                    source_fingerprint="a" * 64,
                    source_revision_uuid="source-revision",
                    prepared_musicxml_object_key="objects/live.xml",
                    artifact_object_key="objects/live.json",
                    status="READY",
                )
                .returning(sources.c.id)
            ).scalar_one()
            orphan_id = connection.execute(
                sources.insert()
                .values(
                    **values,
                    snapshot_uuid=str(uuid4()),
                    source_fingerprint="b" * 64,
                    source_revision_uuid="deleted-revision",
                    prepared_musicxml_object_key="objects/orphan.xml",
                    artifact_object_key="objects/orphan.json",
                    status="DELETING",
                )
                .returning(sources.c.id)
            ).scalar_one()
            connection.execute(
                outboxes.insert().values(
                    outbox_uuid=str(uuid4()),
                    source_snapshot_id=orphan_id,
                    snapshot_uuid=str(uuid4()),
                    storage_backend="local",
                    prepared_musicxml_object_key="objects/orphan.xml",
                    artifact_object_key="objects/orphan.json",
                    status="PROCESSING",
                    attempt_count=1,
                    next_attempt_at=now,
                    created_at=now,
                    updated_at=now,
                )
            )
        command.upgrade(config, "head")
        assert_current_source_schema(engine)
        with engine.begin() as connection:
            rows = (
                connection.execute(sa.text("SELECT * FROM practice_sources ORDER BY id"))
                .mappings()
                .all()
            )
            assert (rows[0]["id"], rows[0]["source_id"], rows[0]["live_revision_id"]) == (
                live_id,
                "a" * 64,
                revision_id,
            )
            assert rows[1]["id"] == orphan_id
            assert rows[1]["live_revision_id"] is None
            assert rows[0]["prepared_musicxml_object_key"] == "objects/live.xml"
            outbox = (
                connection.execute(sa.text("SELECT * FROM practice_source_delete_outbox"))
                .mappings()
                .one()
            )
            assert outbox["source_id"] == "b" * 64
            assert outbox["practice_source_id"] == orphan_id
            assert outbox["status"] == "PENDING"
            connection.execute(
                sa.text("DELETE FROM score_revisions WHERE id = :id"), {"id": revision_id}
            )
            assert (
                connection.execute(
                    sa.text("SELECT live_revision_id FROM practice_sources WHERE id = :id"),
                    {"id": live_id},
                ).scalar_one()
                is None
            )


def test_fresh_upgrade_matches_source_models(monkeypatch):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        assert_current_source_schema(engine)


def test_reservation_provenance_upgrade_preserves_exact_source_lineage(monkeypatch):
    from sqlalchemy.orm import Session
    from app.db.models import PracticeSourceRecord

    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0055_durable_practice_source")
        with Session(engine) as db:
            user = User(
                email="source-lineage@example.com", display_name="Lineage", password_hash="test"
            )
            db.add(user)
            source = PracticeSourceRecord(
                source_id="canonical-source",
                source_score_uuid="s",
                source_revision_uuid="r",
                artifact_id="a",
                artifact_schema_version=1,
                prepared_musicxml_object_key="source.xml",
                prepared_musicxml_sha256="a" * 64,
                prepared_musicxml_byte_size=10,
                artifact_object_key="artifact.json",
                artifact_sha256="b" * 64,
                artifact_byte_size=20,
                status="READY",
            )
            db.add(source)
            db.commit()
            user_id, source_pk = user.id, source.id
        reservations = sa.Table(
            "performance_take_upload_reservations", sa.MetaData(), autoload_with=engine
        )
        now = utc_now_naive()
        with engine.begin() as connection:
            reservation_id = connection.execute(
                reservations.insert()
                .values(
                    reservation_uuid=str(uuid4()),
                    user_id=user_id,
                    practice_source_id=source_pk,
                    client_request_id="lineage",
                    take_uuid=str(uuid4()),
                    score_id=None,
                    score_uuid="s",
                    score_title="Title",
                    revision_id=None,
                    revision_uuid="r",
                    artifact_id="a",
                    scope_type="FULL",
                    scope_start_beat=0,
                    scope_terminal_beat=4,
                    tempo_plan="{}",
                    recording_timebase="{}",
                    duration_ms=1000,
                    media_kind="AUDIO",
                    media_mime_type="audio/webm",
                    media_byte_size=10,
                    storage_backend="local",
                    staging_object_key="staging.webm",
                    storage_reservation_id="quota",
                    expires_at=now,
                    status="RESERVED",
                    created_at=now,
                    updated_at=now,
                )
                .returning(reservations.c.id)
            ).scalar_one()
        command.upgrade(config, "head")
        assert_current_source_schema(engine)
        with engine.connect() as connection:
            row = (
                connection.execute(
                    sa.text("SELECT * FROM performance_take_upload_reservations WHERE id = :id"),
                    {"id": reservation_id},
                )
                .mappings()
                .one()
            )
            assert row["practice_source_id"] == source_pk
            assert row["score_title"] == "Title"
            assert row["linked_score_id"] is None
            assert (
                connection.execute(
                    sa.text("SELECT source_id FROM practice_sources WHERE id = :id"),
                    {"id": row["practice_source_id"]},
                ).scalar_one()
                == "canonical-source"
            )
