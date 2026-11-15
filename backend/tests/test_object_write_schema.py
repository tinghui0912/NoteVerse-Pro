"""Current PostgreSQL write-intent evidence and fencing schema."""

from datetime import timedelta
import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.db.models import ObjectWriteIntent
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


def test_current_write_statuses_key_uniqueness_and_attempt_bounds(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        assert inspector.get_foreign_keys("object_write_intents") == []
        with Session(engine) as db:
            facts = dict(
                byte_size=0,
                sha256="a" * 64,
                content_type="application/octet-stream",
                write_token="generation",
                write_expires_at=utc_now() + timedelta(minutes=15),
            )
            statuses = [
                "PREPARED",
                "WRITTEN",
                "ADOPTED",
                "CLEANUP_PENDING",
                "CLEANUP_DISPATCHED",
                "CLEANUP_PROCESSING",
                "CLEANUP_FAILED",
                "CLEANED",
            ]
            for status in statuses:
                db.add(
                    ObjectWriteIntent(
                        object_key="writes/" + status,
                        status=status,
                        attempt_token="fixture-token" if status == "CLEANUP_PROCESSING" else None,
                        **facts,
                    )
                )
            db.commit()
            assert set(db.scalars(sa.select(ObjectWriteIntent.status))) == set(statuses)
            for patch in [
                {"object_key": "writes/PREPARED"},
                {"status": "INVALID"},
                {"attempt_count": -1},
            ]:
                with pytest.raises(IntegrityError):
                    db.add(ObjectWriteIntent(**(facts | {"object_key": "writes/new"} | patch)))
                    db.commit()
                db.rollback()
