"""Durable deletion fence schema and existing attempted-operation safety."""

import pytest
from sqlalchemy import text, inspect
from alembic import command
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


@pytest.mark.parametrize(
    "status,attempts,fenced",
    [
        ("PENDING", 0, False),
        ("DISPATCHED", 1, True),
        ("PROCESSING", 1, True),
        ("FAILED", 1, True),
        ("CANCELLED", 1, False),
        ("COMPLETED", 1, False),
    ],
)
def test_upgrade_fences_attempted_unfinished_retirement(monkeypatch, status, attempts, fenced):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0002_storage_quota")
        now = utc_now()
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO stored_object_retirements(retirement_uuid,object_key,byte_size,sha256,content_type,status,attempt_count,attempt_token,next_attempt_at,created_at,updated_at) VALUES ('operation','opaque',0,:sha,'application/octet-stream',:status,:attempts,:token,:now,:now,:now)"
                ),
                {
                    "sha": "a" * 64,
                    "status": status,
                    "attempts": attempts,
                    "token": "lease" if status == "PROCESSING" else None,
                    "now": now,
                },
            )
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT deletion_fenced_at FROM stored_object_retirements"))
                is not None
            ) == fenced
        if fenced:
            with pytest.raises(RuntimeError, match="must complete"):
                command.downgrade(config, "0002_storage_quota")
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE stored_object_retirements SET status='COMPLETED', attempt_token=NULL"
                    )
                )
        command.downgrade(config, "0002_storage_quota")
        with engine.connect() as connection:
            assert "deletion_fenced_at" not in {
                column["name"]
                for column in inspect(connection).get_columns("stored_object_retirements")
            }
        command.upgrade(config, "head")
