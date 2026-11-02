"""Executable PostgreSQL reservation lease and status constraints."""

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.exc import IntegrityError
from app.db.models import User
from app.utils.timezone import utc_now_naive
from tests.test_practice_source_migration import migration_database
from tests.test_upload_reservation_migration import reservation_values


@pytest.mark.parametrize(
    "status,lease,valid",
    [
        ("RESERVED", False, True),
        ("FINALIZING", True, True),
        ("COMPLETED", False, True),
        ("CANCELLED", False, True),
        ("EXPIRED", False, True),
        ("INVALID", False, False),
        ("RESERVED", True, False),
        ("FINALIZING", False, False),
        ("COMPLETED", True, False),
        ("CANCELLED", True, False),
        ("EXPIRED", True, False),
    ],
)
def test_fresh_schema_enforces_current_lifecycle_tuples(monkeypatch, status, lease, valid):
    with migration_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        users = sa.Table("users", sa.MetaData(), autoload_with=engine)
        reservations = sa.Table(
            "performance_take_upload_reservations", sa.MetaData(), autoload_with=engine
        )
        with engine.begin() as connection:
            user_id = connection.execute(
                users.insert()
                .values(
                    **User(
                        email="lease@example.com", display_name="Lease", password_hash="test"
                    ).model_dump(exclude={"id"})
                )
                .returning(users.c.id)
            ).scalar_one()
        values = {**reservation_values(user_id), "status": status}
        if lease:
            values.update(
                finalizing_token="token",
                finalizing_object_key="candidate",
                finalizing_expires_at=utc_now_naive(),
            )
        if valid:
            with engine.begin() as connection:
                connection.execute(reservations.insert().values(**values))
        else:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(reservations.insert().values(**values))
