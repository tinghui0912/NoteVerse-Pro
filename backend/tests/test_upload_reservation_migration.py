"""PostgreSQL migration preserves reservation identity and establishes unique Take lineage."""

from datetime import timedelta
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from alembic import command
from alembic.config import Config

from app.db.models import User, PracticeSourceSnapshot
from app.utils.timezone import utc_now_naive


def test_0054_preserves_rows_identities_statuses_and_unique_lineage(monkeypatch):
    raw_url = os.environ.get("NOTEVERSE_TEST_PRACTICE_SOURCE_POSTGRES_URL")
    if not raw_url:
        pytest.skip(
            "Set NOTEVERSE_TEST_PRACTICE_SOURCE_POSTGRES_URL for PostgreSQL migration validation"
        )
    parsed = make_url(raw_url).set(drivername="postgresql+psycopg")
    assert (parsed.database or "").startswith(
        "noteverse_test_"
    ) or parsed.database == "noteverse_test"
    schema = "take_migration_" + uuid4().hex
    admin = sa.create_engine(parsed)
    with admin.begin() as connection:
        connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    monkeypatch.setenv("PGOPTIONS", f"-csearch_path={schema}")
    url = parsed
    engine = sa.create_engine(url)
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    config.set_main_option(
        "sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%")
    )
    try:
        command.upgrade(config, "0053_practice_source_takes")
        with Session(engine) as db:
            user = User(
                email="migration@example.com", display_name="Migration", password_hash="test"
            )
            snapshot = PracticeSourceSnapshot(
                source_fingerprint="fingerprint",
                source_score_uuid=str(uuid4()),
                source_revision_uuid=str(uuid4()),
                artifact_id="artifact",
                artifact_schema_version=1,
                prepared_musicxml_object_key="source.xml",
                prepared_musicxml_sha256="a" * 64,
                prepared_musicxml_byte_size=10,
                artifact_object_key="artifact.json",
                artifact_sha256="b" * 64,
                artifact_byte_size=10,
                status="READY",
            )
            db.add_all([user, snapshot])
            db.commit()
            db.refresh(user)
            db.refresh(snapshot)
            user_id, snapshot_id = user.id, snapshot.id
        metadata = sa.MetaData()
        authorizations = sa.Table(
            "performance_take_upload_authorizations", metadata, autoload_with=engine
        )
        takes = sa.Table("performance_takes", metadata, autoload_with=engine)
        reservation_uuid, quota_id, take_uuid = str(uuid4()), str(uuid4()), str(uuid4())
        values = dict(
            auth_uuid=reservation_uuid,
            user_id=user_id,
            source_snapshot_id=None,
            client_request_id="request",
            take_uuid=take_uuid,
            score_uuid="score",
            score_title="Score",
            revision_uuid="revision",
            artifact_id="artifact",
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
            final_object_key="final.webm",
            reservation_id=quota_id,
            expires_at=utc_now_naive() + timedelta(hours=1),
            status="ARCHIVED",
        )
        with engine.begin() as connection:
            reservation_row_id = connection.execute(
                authorizations.insert().values(**values).returning(authorizations.c.id)
            ).scalar_one()
            connection.execute(
                authorizations.insert().values(
                    **{
                        **values,
                        "auth_uuid": str(uuid4()),
                        "take_uuid": str(uuid4()),
                        "client_request_id": "pending",
                        "source_snapshot_id": snapshot_id,
                        "status": "AUTHORIZED",
                    }
                )
            )
            connection.execute(
                takes.insert().values(
                    take_uuid=take_uuid,
                    user_id=user_id,
                    source_snapshot_id=snapshot_id,
                    score_title_snapshot="Score",
                    client_request_id="request",
                    media_kind="AUDIO",
                    media_mime_type="audio/webm",
                    media_byte_size=10,
                    media_object_key="final.webm",
                    storage_backend="local",
                    duration_ms=1000,
                    scope_type="FULL",
                    scope_start_beat=0,
                    scope_terminal_beat=4,
                    tempo_plan="{}",
                    recording_timebase="{}",
                )
            )
        for _ in range(2):
            command.upgrade(config, "0054_take_upload_reservations")
            inspector = sa.inspect(engine)
            table_names = inspector.get_table_names()
            assert "performance_take_upload_reservations" in table_names
            reservation_table = sa.Table(
                "performance_take_upload_reservations", sa.MetaData(), autoload_with=engine
            )
            take_table = sa.Table("performance_takes", sa.MetaData(), autoload_with=engine)
            with engine.connect() as connection:
                reservation = (
                    connection.execute(
                        sa.select(reservation_table).where(
                            reservation_table.c.id == reservation_row_id
                        )
                    )
                    .mappings()
                    .one()
                )
                take = connection.execute(sa.select(take_table)).mappings().one()
                assert (
                    reservation["reservation_uuid"]
                    == reservation_uuid
                    != reservation["storage_reservation_id"]
                    == quota_id
                )
                assert reservation["status"] == "COMPLETED"
                assert (
                    connection.execute(
                        sa.select(reservation_table.c.status).where(
                            reservation_table.c.client_request_id == "pending"
                        )
                    ).scalar_one()
                    == "RESERVED"
                )
                assert (
                    take["upload_reservation_id"] == reservation_row_id
                    and take["take_uuid"] == take_uuid
                )
                assert "client_request_id" not in take
            columns = {
                column["name"]: column for column in inspector.get_columns("performance_takes")
            }
            assert columns["upload_reservation_id"]["nullable"] is False
            fk = next(
                fk
                for fk in inspector.get_foreign_keys("performance_takes")
                if fk["constrained_columns"] == ["upload_reservation_id"]
            )
            assert fk["referred_table"] == "performance_take_upload_reservations"
            assert any(
                uq["column_names"] == ["upload_reservation_id"]
                for uq in inspector.get_unique_constraints("performance_takes")
            )
            with pytest.raises(IntegrityError), engine.begin() as connection:
                duplicate = {**take, "take_uuid": str(uuid4()), "media_object_key": "second.webm"}
                duplicate.pop("id")
                connection.execute(take_table.insert().values(**duplicate))
            command.downgrade(config, "0053_practice_source_takes")
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
