"""Isolated SQL design experiment, not production schema or an ORM migration.

An explicit FK arc binds one ingress Session to exactly one concrete domain
command. This tests the RFC proposal on PostgreSQL before implementation approval.
"""

from concurrent.futures import ThreadPoolExecutor
from queue import Queue

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.test_asset_gate_postgres import wait_for_blocker


@pytest.fixture
def binding_design(postgres_engine):
    with postgres_engine.begin() as db:
        for name in (
            "gate_sessions",
            "gate_upload_commands",
            "gate_avatar_commands",
            "gate_take_reservations",
        ):
            db.execute(
                text(
                    f"CREATE TABLE {name} (id bigint PRIMARY KEY, user_id bigint NOT NULL, UNIQUE(id,user_id))"
                )
            )
            db.execute(text(f"INSERT INTO {name} VALUES (1,1),(2,2)"))
        db.execute(
            text("""CREATE TABLE gate_session_bindings (
          session_id bigint PRIMARY KEY,
          user_id bigint NOT NULL,
          command_generation integer NOT NULL CHECK(command_generation>0),
          upload_command_id bigint,
          avatar_command_id bigint,
          take_reservation_id bigint,
          CHECK(num_nonnulls(upload_command_id,avatar_command_id,take_reservation_id)=1),
          FOREIGN KEY(session_id,user_id) REFERENCES gate_sessions(id,user_id) ON DELETE RESTRICT,
          FOREIGN KEY(upload_command_id,user_id) REFERENCES gate_upload_commands(id,user_id) ON DELETE RESTRICT,
          FOREIGN KEY(avatar_command_id,user_id) REFERENCES gate_avatar_commands(id,user_id) ON DELETE RESTRICT,
          FOREIGN KEY(take_reservation_id,user_id) REFERENCES gate_take_reservations(id,user_id) ON DELETE RESTRICT,
          UNIQUE(upload_command_id,command_generation),
          UNIQUE(avatar_command_id,command_generation),
          UNIQUE(take_reservation_id,command_generation)
        )""")
        )
    return postgres_engine


@pytest.mark.parametrize("columns", ["NULL,NULL,NULL", "1,1,NULL", "1,1,1"])
def test_explicit_arc_requires_exactly_one_domain(binding_design, columns):
    with binding_design.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text(f"INSERT INTO gate_session_bindings VALUES(1,1,1,{columns})"))


def test_binding_cannot_transfer_input_to_another_user(binding_design):
    with binding_design.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text("INSERT INTO gate_session_bindings VALUES(1,1,1,2,NULL,NULL)"))


def test_two_domains_cannot_bind_the_same_session_concurrently(binding_design):
    engine = binding_design
    ready = Queue()
    with Session(engine) as upload, ThreadPoolExecutor(1) as pool:
        owner = upload.scalar(text("SELECT pg_backend_pid()"))
        upload.execute(text("INSERT INTO gate_session_bindings VALUES(1,1,1,1,NULL,NULL)"))

        def attempt_take():
            with Session(engine) as take:
                ready.put(take.scalar(text("SELECT pg_backend_pid()")))
                with pytest.raises(IntegrityError):
                    take.execute(
                        text("INSERT INTO gate_session_bindings VALUES(1,1,1,NULL,NULL,1)")
                    )
                take.rollback()

        task = pool.submit(attempt_take)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            upload.commit()
        task.result(timeout=10)
    with engine.connect() as db:
        assert db.execute(
            text(
                "SELECT session_id,user_id,upload_command_id,take_reservation_id FROM gate_session_bindings"
            )
        ).one() == (1, 1, 1, None)


def test_live_binding_prevents_silent_parent_deletion(binding_design):
    with binding_design.begin() as db:
        db.execute(text("INSERT INTO gate_session_bindings VALUES(1,1,1,NULL,1,NULL)"))
    with binding_design.begin() as db:
        with pytest.raises(IntegrityError):
            db.execute(text("DELETE FROM gate_avatar_commands WHERE id=1"))
