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
        db.execute(
            text("""CREATE TABLE gate_sessions (
            id bigint PRIMARY KEY, user_id bigint NOT NULL, UNIQUE(id,user_id),
            terminal boolean NOT NULL DEFAULT false
        )""")
        )
        db.execute(
            text("""CREATE TABLE gate_cleanup_operations (
            id bigint PRIMARY KEY, session_id bigint UNIQUE REFERENCES gate_sessions(id) ON DELETE SET NULL,
            session_id_snapshot bigint NOT NULL, cleanup_acknowledged boolean NOT NULL
        )""")
        )
        for name in ("gate_upload_commands", "gate_avatar_commands", "gate_take_reservations"):
            db.execute(
                text(
                    f"CREATE TABLE {name} (id bigint PRIMARY KEY, user_id bigint NOT NULL, UNIQUE(id,user_id))"
                )
            )
            db.execute(text(f"INSERT INTO {name} VALUES (1,1),(2,2),(3,1)"))
        db.execute(
            text("""CREATE TABLE gate_session_bindings (
          session_id bigint PRIMARY KEY,
          user_id bigint NOT NULL,
          command_generation integer NOT NULL CHECK(command_generation>0),
          upload_command_id bigint, avatar_command_id bigint, take_reservation_id bigint,
          CHECK(num_nonnulls(upload_command_id,avatar_command_id,take_reservation_id)=1),
          FOREIGN KEY(session_id,user_id) REFERENCES gate_sessions(id,user_id) ON DELETE RESTRICT,
          FOREIGN KEY(upload_command_id,user_id) REFERENCES gate_upload_commands(id,user_id) ON DELETE RESTRICT,
          FOREIGN KEY(avatar_command_id,user_id) REFERENCES gate_avatar_commands(id,user_id) ON DELETE RESTRICT,
          FOREIGN KEY(take_reservation_id,user_id) REFERENCES gate_take_reservations(id,user_id) ON DELETE RESTRICT,
          UNIQUE(upload_command_id,command_generation), UNIQUE(avatar_command_id,command_generation),
          UNIQUE(take_reservation_id,command_generation)
        )""")
        )
        # A SQL prototype only: one separate operation result owns the cleanup ACK.
        # The session retains no duplicate ACK field.
        db.execute(
            text("""CREATE FUNCTION gate_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF ROW(NEW.session_id,NEW.user_id,NEW.command_generation,NEW.upload_command_id,NEW.avatar_command_id,NEW.take_reservation_id)
            IS DISTINCT FROM ROW(OLD.session_id,OLD.user_id,OLD.command_generation,OLD.upload_command_id,OLD.avatar_command_id,OLD.take_reservation_id) THEN
            RAISE EXCEPTION 'binding identity is immutable' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$""")
        )
        db.execute(
            text(
                "CREATE TRIGGER gate_binding_immutable BEFORE UPDATE ON gate_session_bindings FOR EACH ROW EXECUTE FUNCTION gate_binding_immutable()"
            )
        )
        db.execute(
            text("""CREATE FUNCTION gate_binding_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM gate_sessions s JOIN gate_cleanup_operations o ON o.session_id=s.id WHERE s.id=OLD.session_id AND s.terminal AND o.cleanup_acknowledged) THEN
            RAISE EXCEPTION 'session cleanup must be acknowledged before unlink' USING ERRCODE='23514';
          END IF;
          RETURN OLD;
        END $$""")
        )
        db.execute(
            text(
                "CREATE TRIGGER gate_binding_release_guard BEFORE DELETE ON gate_session_bindings FOR EACH ROW EXECUTE FUNCTION gate_binding_release_guard()"
            )
        )
        db.execute(
            text("""CREATE FUNCTION gate_session_binding_required() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS(SELECT 1 FROM gate_sessions WHERE id=NEW.id)
            AND NOT EXISTS(SELECT 1 FROM gate_session_bindings WHERE session_id=NEW.id) THEN
            RAISE EXCEPTION 'committed session must have one binding' USING ERRCODE='23514';
          END IF;
          RETURN NULL;
        END $$""")
        )
        db.execute(
            text(
                "CREATE CONSTRAINT TRIGGER gate_session_binding_required AFTER INSERT OR UPDATE ON gate_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_session_binding_required()"
            )
        )
        db.execute(
            text("""CREATE FUNCTION gate_binding_delete_requires_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS(SELECT 1 FROM gate_sessions WHERE id=OLD.session_id) THEN
            RAISE EXCEPTION 'unlink requires same-transaction session deletion' USING ERRCODE='23514';
          END IF;
          RETURN NULL;
        END $$""")
        )
        db.execute(
            text(
                "CREATE CONSTRAINT TRIGGER gate_binding_delete_requires_session_delete AFTER DELETE ON gate_session_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gate_binding_delete_requires_session_delete()"
            )
        )
    return postgres_engine


def add_binding(db, session_id=1, domain="upload", *, command_id=1, user_id=1):
    column = {
        "upload": "upload_command_id",
        "avatar": "avatar_command_id",
        "take": "take_reservation_id",
    }[domain]
    db.execute(
        text("INSERT INTO gate_sessions(id,user_id) VALUES(:id,:user)"),
        {"id": session_id, "user": user_id},
    )
    db.execute(
        text(
            f"INSERT INTO gate_session_bindings(session_id,user_id,command_generation,{column}) VALUES(:id,:user,1,:command)"
        ),
        {"id": session_id, "user": user_id, "command": command_id},
    )


@pytest.mark.parametrize("columns", ["NULL,NULL,NULL", "1,1,NULL", "1,1,1"])
def test_explicit_arc_requires_exactly_one_domain(binding_design, columns):
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        db.execute(text("INSERT INTO gate_sessions(id,user_id) VALUES(1,1)"))
        db.execute(text(f"INSERT INTO gate_session_bindings VALUES(1,1,1,{columns})"))


def test_binding_cannot_transfer_input_to_another_user(binding_design):
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        add_binding(db, command_id=2)


def test_two_domains_cannot_bind_the_same_session_concurrently(binding_design):
    engine = binding_design
    ready = Queue()
    with Session(engine) as upload, ThreadPoolExecutor(1) as pool:
        owner = upload.scalar(text("SELECT pg_backend_pid()"))
        add_binding(upload)

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
        add_binding(db, domain="avatar")
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        db.execute(text("DELETE FROM gate_avatar_commands WHERE id=1"))


@pytest.mark.parametrize(
    "domain,update",
    [
        ("upload", "upload_command_id=NULL,avatar_command_id=1"),
        ("take", "take_reservation_id=NULL,upload_command_id=1"),
        ("upload", "user_id=2"),
        ("upload", "command_generation=2"),
        ("upload", "session_id=3"),
        ("upload", "upload_command_id=3"),
    ],
)
def test_binding_identity_cannot_be_updated(binding_design, domain, update):
    with binding_design.begin() as db:
        add_binding(db, domain=domain)
    with (
        pytest.raises(IntegrityError, match="binding identity is immutable"),
        binding_design.begin() as db,
    ):
        db.execute(text(f"UPDATE gate_session_bindings SET {update} WHERE session_id=1"))


@pytest.mark.parametrize("domain", ["upload", "avatar", "take"])
def test_command_generation_has_at_most_one_session(binding_design, domain):
    with binding_design.begin() as db:
        add_binding(db, domain=domain)
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        add_binding(db, session_id=3, domain=domain)
    with binding_design.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 1


@pytest.mark.parametrize("domain", ["upload", "avatar", "take"])
def test_concurrent_same_command_generation_has_one_winner(binding_design, domain):
    engine, ready = binding_design, Queue()
    with Session(engine) as first, ThreadPoolExecutor(1) as pool:
        owner = first.scalar(text("SELECT pg_backend_pid()"))
        add_binding(first, domain=domain)

        def other_session():
            with Session(engine) as second:
                ready.put(second.scalar(text("SELECT pg_backend_pid()")))
                with pytest.raises(IntegrityError):
                    add_binding(second, session_id=3, domain=domain)
                second.rollback()

        task = pool.submit(other_session)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            first.commit()
        task.result(timeout=10)
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 1
        assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 1


def test_session_without_binding_cannot_commit(binding_design):
    with (
        pytest.raises(IntegrityError, match="committed session must have one binding"),
        binding_design.begin() as db,
    ):
        db.execute(text("INSERT INTO gate_sessions(id,user_id) VALUES(1,1)"))
    with binding_design.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 0


def test_binding_cannot_be_unlinked_before_cleanup(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
    with (
        pytest.raises(IntegrityError, match="cleanup must be acknowledged"),
        binding_design.begin() as db,
    ):
        db.execute(text("DELETE FROM gate_session_bindings"))


def seed_cleaned_binding(engine):
    with engine.begin() as db:
        add_binding(db)
        db.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
        db.execute(text("INSERT INTO gate_cleanup_operations VALUES(1,1,1,true)"))


def test_cleaned_binding_cannot_be_deleted_without_session(binding_design):
    seed_cleaned_binding(binding_design)
    with (
        pytest.raises(IntegrityError, match="same-transaction session deletion"),
        binding_design.begin() as db,
    ):
        db.execute(text("DELETE FROM gate_session_bindings"))


def test_delete_insert_cannot_retarget_terminal_session(binding_design):
    seed_cleaned_binding(binding_design)
    with (
        pytest.raises(IntegrityError, match="same-transaction session deletion"),
        binding_design.begin() as db,
    ):
        db.execute(text("DELETE FROM gate_session_bindings"))
        db.execute(text("INSERT INTO gate_session_bindings VALUES(1,1,1,NULL,1,NULL)"))


def test_session_and_binding_deletion_is_atomic(binding_design):
    seed_cleaned_binding(binding_design)
    with pytest.raises(RuntimeError, match="injected"), binding_design.begin() as db:
        db.execute(text("DELETE FROM gate_session_bindings"))
        raise RuntimeError("injected after unlink")
    with binding_design.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 1
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 1
    with binding_design.begin() as db:
        db.execute(text("DELETE FROM gate_session_bindings"))
        db.execute(text("DELETE FROM gate_sessions"))
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        db.execute(text("INSERT INTO gate_session_bindings VALUES(1,1,1,NULL,1,NULL)"))
    with binding_design.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 0
        assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 0
        assert db.execute(
            text(
                "SELECT session_id,session_id_snapshot,cleanup_acknowledged FROM gate_cleanup_operations"
            )
        ).one() == (None, 1, True)
