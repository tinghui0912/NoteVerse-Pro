"""Isolated SQL design experiment, not production schema or an ORM migration.

An explicit FK arc binds one ingress Session to exactly one concrete domain
command. This tests the RFC proposal on PostgreSQL before implementation approval.
"""

from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from uuid import uuid4

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
            session_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
            generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
            terminal boolean NOT NULL DEFAULT false
        )""")
        )
        db.execute(
            text("""CREATE TABLE gate_physical_operations (
            id bigint PRIMARY KEY, session_id bigint REFERENCES gate_sessions(id) ON DELETE SET NULL,
            session_uuid_snapshot uuid NOT NULL, session_generation integer NOT NULL CHECK(session_generation>0),
            operation_kind text NOT NULL CHECK(operation_kind IN ('INITIATE','COMPLETE','VERIFY','CLEANUP')),
            attempt_token uuid NOT NULL, published_attempt_token uuid,
            operation_result text NOT NULL DEFAULT 'NONE' CHECK(operation_result IN ('NONE','SUCCEEDED','CLEANED')),
            settlement_status text NOT NULL DEFAULT 'PENDING' CHECK(settlement_status IN ('PENDING','UNKNOWN','SETTLED')),
            UNIQUE(session_uuid_snapshot,session_generation,operation_kind),
            CHECK((settlement_status='SETTLED' AND operation_result<>'NONE' AND published_attempt_token=attempt_token AND published_attempt_token IS NOT NULL)
                OR (settlement_status<>'SETTLED' AND operation_result='NONE' AND published_attempt_token IS NULL)),
            CHECK(operation_result<>'CLEANED' OR operation_kind='CLEANUP'),
            CHECK(operation_kind<>'CLEANUP' OR operation_result IN ('NONE','CLEANED'))
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
        # Only this operation ledger publishes cleanup results; Session has no ACK field.
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
          PERFORM 1 FROM gate_sessions WHERE id=OLD.session_id FOR UPDATE;
          IF NOT EXISTS(SELECT 1 FROM gate_sessions s JOIN gate_physical_operations o
            ON o.session_id=s.id AND o.session_uuid_snapshot=s.session_uuid AND o.session_generation=s.generation
            WHERE s.id=OLD.session_id AND s.terminal AND o.operation_kind='CLEANUP'
              AND o.operation_result='CLEANED' AND o.settlement_status='SETTLED'
              AND o.published_attempt_token=o.attempt_token)
            OR EXISTS(SELECT 1 FROM gate_physical_operations o JOIN gate_sessions s
              ON (o.session_id=s.id OR o.session_uuid_snapshot=s.session_uuid)
              WHERE s.id=OLD.session_id AND o.settlement_status<>'SETTLED') THEN
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
        install_operation_and_generation_guards(db)
    return postgres_engine


def install_operation_and_generation_guards(db):
    """Isolated DDL: no model/migration, no claim to verify external settlement."""
    db.execute(
        text("""CREATE FUNCTION gate_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'operation evidence requires approved retention' USING ERRCODE='23514';
      END IF;
      IF TG_OP='INSERT' AND (NEW.settlement_status<>'PENDING' OR NEW.operation_result<>'NONE' OR NEW.published_attempt_token IS NOT NULL) THEN
        RAISE EXCEPTION 'operation must start pending without result' USING ERRCODE='23514';
      END IF;
      IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.session_uuid_snapshot,NEW.session_generation,NEW.operation_kind)
          IS DISTINCT FROM ROW(OLD.id,OLD.session_uuid_snapshot,OLD.session_generation,OLD.operation_kind) THEN
          RAISE EXCEPTION 'operation identity is immutable' USING ERRCODE='23514';
        END IF;
        IF NEW.session_id IS DISTINCT FROM OLD.session_id AND NOT
          (OLD.session_id IS NOT NULL AND NEW.session_id IS NULL AND NOT EXISTS(SELECT 1 FROM gate_sessions WHERE id=OLD.session_id)) THEN
          RAISE EXCEPTION 'operation parent cannot retarget' USING ERRCODE='23514';
        END IF;
        IF OLD.settlement_status='SETTLED' AND ROW(NEW.attempt_token,NEW.published_attempt_token,NEW.operation_result,NEW.settlement_status)
          IS DISTINCT FROM ROW(OLD.attempt_token,OLD.published_attempt_token,OLD.operation_result,OLD.settlement_status) THEN
          RAISE EXCEPTION 'settled result is immutable' USING ERRCODE='23514';
        END IF;
        IF NEW.operation_result<>'NONE' AND
          (NEW.attempt_token<>OLD.attempt_token OR NEW.published_attempt_token IS DISTINCT FROM OLD.attempt_token) THEN
          RAISE EXCEPTION 'publication must match current attempt' USING ERRCODE='23514';
        END IF;
      END IF;
      IF NEW.session_id IS NOT NULL THEN
        PERFORM 1 FROM gate_sessions WHERE id=NEW.session_id FOR KEY SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'operation requires live parent' USING ERRCODE='23514'; END IF;
      ELSIF TG_OP='INSERT' THEN
        RAISE EXCEPTION 'new operation requires parent' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$""")
    )
    db.execute(
        text(
            "CREATE TRIGGER gate_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON gate_physical_operations FOR EACH ROW EXECUTE FUNCTION gate_operation_guard()"
        )
    )
    db.execute(
        text("""CREATE FUNCTION gate_session_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ROW(NEW.id,NEW.user_id,NEW.session_uuid,NEW.generation) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.session_uuid,OLD.generation) THEN
        RAISE EXCEPTION 'session identity is immutable' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$""")
    )
    db.execute(
        text(
            "CREATE TRIGGER gate_session_identity_immutable BEFORE UPDATE ON gate_sessions FOR EACH ROW EXECUTE FUNCTION gate_session_identity_immutable()"
        )
    )
    for domain, commands in (
        ("upload", "gate_upload_commands"),
        ("avatar", "gate_avatar_commands"),
        ("take", "gate_take_reservations"),
    ):
        db.execute(
            text(f"""CREATE TABLE gate_{domain}_generations (
          command_id bigint NOT NULL REFERENCES {commands}(id) ON DELETE CASCADE,
          generation integer NOT NULL CHECK(generation>0),
          state text NOT NULL CHECK(state IN ('OPEN','ADMITTED','TERMINAL')),
          session_uuid_snapshot uuid,
          PRIMARY KEY(command_id,generation),
          CHECK((state='OPEN' AND session_uuid_snapshot IS NULL) OR (state<>'OPEN' AND session_uuid_snapshot IS NOT NULL))
        )""")
        )
        db.execute(
            text(
                f"INSERT INTO gate_{domain}_generations(command_id,generation,state) VALUES (1,1,'OPEN'),(2,1,'OPEN'),(3,1,'OPEN')"
            )
        )
    db.execute(
        text("""CREATE FUNCTION gate_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        IF (TG_TABLE_NAME='gate_upload_generations' AND EXISTS(SELECT 1 FROM gate_upload_commands WHERE id=OLD.command_id))
          OR (TG_TABLE_NAME='gate_avatar_generations' AND EXISTS(SELECT 1 FROM gate_avatar_commands WHERE id=OLD.command_id))
          OR (TG_TABLE_NAME='gate_take_generations' AND EXISTS(SELECT 1 FROM gate_take_reservations WHERE id=OLD.command_id)) THEN
          RAISE EXCEPTION 'generation lineage survives binding deletion' USING ERRCODE='23514';
        END IF;
        RETURN OLD;
      END IF;
      IF ROW(NEW.command_id,NEW.generation) IS DISTINCT FROM ROW(OLD.command_id,OLD.generation)
        OR NOT ((OLD.state='OPEN' AND NEW.state='ADMITTED') OR (OLD.state='ADMITTED' AND NEW.state='TERMINAL'))
        OR (OLD.state<>'OPEN' AND NEW.session_uuid_snapshot IS DISTINCT FROM OLD.session_uuid_snapshot) THEN
        RAISE EXCEPTION 'command generation is monotone and immutable' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$""")
    )
    for domain in ("upload", "avatar", "take"):
        db.execute(
            text(
                f"CREATE TRIGGER gate_generation_guard BEFORE UPDATE OR DELETE ON gate_{domain}_generations FOR EACH ROW EXECUTE FUNCTION gate_generation_guard()"
            )
        )
    db.execute(
        text("""CREATE FUNCTION gate_binding_generation() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE session_identity uuid;
    BEGIN
      IF TG_OP='INSERT' THEN
        SELECT session_uuid INTO session_identity FROM gate_sessions WHERE id=NEW.session_id;
        IF NEW.upload_command_id IS NOT NULL THEN
          UPDATE gate_upload_generations SET state='ADMITTED',session_uuid_snapshot=session_identity
            WHERE command_id=NEW.upload_command_id AND generation=NEW.command_generation AND state='OPEN';
        ELSIF NEW.avatar_command_id IS NOT NULL THEN
          UPDATE gate_avatar_generations SET state='ADMITTED',session_uuid_snapshot=session_identity
            WHERE command_id=NEW.avatar_command_id AND generation=NEW.command_generation AND state='OPEN';
        ELSE
          UPDATE gate_take_generations SET state='ADMITTED',session_uuid_snapshot=session_identity
            WHERE command_id=NEW.take_reservation_id AND generation=NEW.command_generation AND state='OPEN';
        END IF;
        IF NOT FOUND THEN RAISE EXCEPTION 'command generation cannot readmit' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END IF;
      IF OLD.upload_command_id IS NOT NULL THEN
        UPDATE gate_upload_generations SET state='TERMINAL' WHERE command_id=OLD.upload_command_id AND generation=OLD.command_generation;
      ELSIF OLD.avatar_command_id IS NOT NULL THEN
        UPDATE gate_avatar_generations SET state='TERMINAL' WHERE command_id=OLD.avatar_command_id AND generation=OLD.command_generation;
      ELSE
        UPDATE gate_take_generations SET state='TERMINAL' WHERE command_id=OLD.take_reservation_id AND generation=OLD.command_generation;
      END IF;
      RETURN OLD;
    END $$""")
    )
    db.execute(
        text(
            "CREATE TRIGGER gate_binding_generation_admit AFTER INSERT ON gate_session_bindings FOR EACH ROW EXECUTE FUNCTION gate_binding_generation()"
        )
    )
    db.execute(
        text(
            "CREATE TRIGGER gate_binding_generation_terminal AFTER DELETE ON gate_session_bindings FOR EACH ROW EXECUTE FUNCTION gate_binding_generation()"
        )
    )


def add_binding(
    db,
    session_id=1,
    domain="upload",
    *,
    command_id=1,
    user_id=1,
    command_generation=1,
    session_generation=1,
):
    column = {
        "upload": "upload_command_id",
        "avatar": "avatar_command_id",
        "take": "take_reservation_id",
    }[domain]
    db.execute(
        text("INSERT INTO gate_sessions(id,user_id,generation) VALUES(:id,:user,:generation)"),
        {"id": session_id, "user": user_id, "generation": session_generation},
    )
    db.execute(
        text(
            f"INSERT INTO gate_session_bindings(session_id,user_id,command_generation,{column}) VALUES(:id,:user,:generation,:command)"
        ),
        {
            "id": session_id,
            "user": user_id,
            "command": command_id,
            "generation": command_generation,
        },
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


def insert_operation(
    db, *, id=1, session_id=1, uuid=None, generation=None, kind="CLEANUP", token=None
):
    identity, current_generation = db.execute(
        text("SELECT session_uuid,generation FROM gate_sessions WHERE id=:id"), {"id": session_id}
    ).one()
    token = token or uuid4()
    db.execute(
        text("""INSERT INTO gate_physical_operations(id,session_id,session_uuid_snapshot,session_generation,operation_kind,attempt_token)
      VALUES(:id,:session,:uuid,:generation,:kind,:token)"""),
        {
            "id": id,
            "session": session_id,
            "uuid": uuid or identity,
            "generation": generation if generation is not None else current_generation,
            "kind": kind,
            "token": token,
        },
    )
    return token


def publish_cleanup(db, token, *, id=1):
    return db.execute(
        text("""UPDATE gate_physical_operations SET published_attempt_token=:token,operation_result='CLEANED',settlement_status='SETTLED'
      WHERE id=:id AND attempt_token=:token AND operation_kind='CLEANUP' AND settlement_status IN ('PENDING','UNKNOWN')"""),
        {"id": id, "token": token},
    ).rowcount


def seed_cleaned_binding(engine, domain="upload"):
    with engine.begin() as db:
        add_binding(db, domain=domain)
        db.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
        token = insert_operation(db)
        assert publish_cleanup(db, token) == 1


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
                "SELECT session_id,session_generation,operation_kind,operation_result,settlement_status,published_attempt_token=attempt_token FROM gate_physical_operations"
            )
        ).one() == (None, 1, "CLEANUP", "CLEANED", "SETTLED", True)


@pytest.mark.parametrize(
    "fault",
    [
        "missing",
        "generation",
        "old_generation",
        "uuid",
        "kind_INITIATE",
        "kind_COMPLETE",
        "kind_VERIFY",
        "stale_attempt",
        "unsettled_operation",
    ],
)
def test_wrong_operation_evidence_cannot_release_binding(binding_design, fault):
    with binding_design.begin() as db:
        add_binding(db, session_generation=2 if fault == "old_generation" else 1)
        db.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
        if fault != "missing":
            token = insert_operation(
                db,
                uuid=uuid4() if fault == "uuid" else None,
                generation=2
                if fault == "generation"
                else (1 if fault == "old_generation" else None),
                kind=fault.removeprefix("kind_") if fault.startswith("kind_") else "CLEANUP",
            )
            if fault.startswith("kind_"):
                db.execute(
                    text(
                        "UPDATE gate_physical_operations SET published_attempt_token=attempt_token,operation_result='SUCCEEDED',settlement_status='SETTLED'"
                    )
                )
            elif fault == "stale_attempt":
                db.execute(
                    text("UPDATE gate_physical_operations SET attempt_token=:new"), {"new": uuid4()}
                )
                assert publish_cleanup(db, token) == 0
            else:
                assert publish_cleanup(db, token) == 1
            if fault == "unsettled_operation":
                insert_operation(db, id=2, kind="COMPLETE")
                db.execute(
                    text(
                        "UPDATE gate_physical_operations SET settlement_status='UNKNOWN' WHERE id=2"
                    )
                )
    with (
        pytest.raises(IntegrityError, match="cleanup must be acknowledged"),
        binding_design.begin() as db,
    ):
        db.execute(text("DELETE FROM gate_session_bindings"))
    with binding_design.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 1


@pytest.mark.parametrize(
    "change",
    [
        "id=2",
        "session_generation=2",
        "session_uuid_snapshot=gen_random_uuid()",
        "operation_kind='VERIFY'",
        "session_id=NULL",
    ],
)
def test_operation_identity_and_parent_cannot_retarget(binding_design, change):
    with binding_design.begin() as db:
        add_binding(db)
        insert_operation(db)
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        db.execute(text("UPDATE gate_physical_operations SET " + change))


def test_cleanup_operation_identity_is_unique_per_uuid_generation_kind(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        insert_operation(db)
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        insert_operation(db, id=2)


def test_old_attempt_cannot_publish_even_through_unconditional_update(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        old = insert_operation(db)
        db.execute(text("UPDATE gate_physical_operations SET attempt_token=:new"), {"new": uuid4()})
    with (
        pytest.raises(IntegrityError, match="publication must match current attempt"),
        binding_design.begin() as db,
    ):
        db.execute(
            text(
                "UPDATE gate_physical_operations SET published_attempt_token=:old,operation_result='CLEANED',settlement_status='SETTLED'"
            ),
            {"old": old},
        )
    with binding_design.connect() as db:
        assert db.scalar(text("SELECT operation_result FROM gate_physical_operations")) == "NONE"


def test_late_attempt_waits_for_rotation_and_cannot_publish_ack(binding_design):
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        old = insert_operation(db)
    current = uuid4()
    with Session(engine) as takeover, ThreadPoolExecutor(1) as pool:
        owner = takeover.scalar(text("SELECT pg_backend_pid()"))
        takeover.execute(
            text("UPDATE gate_physical_operations SET attempt_token=:new"), {"new": current}
        )

        def old_writer():
            with Session(engine) as db:
                ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                count = publish_cleanup(db, old)
                db.commit()
                return count

        late = pool.submit(old_writer)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            takeover.commit()
        assert late.result(timeout=10) == 0
    with engine.begin() as db:
        assert db.scalar(text("SELECT operation_result FROM gate_physical_operations")) == "NONE"
        assert publish_cleanup(db, current) == 1


def test_settled_cleanup_result_and_snapshot_survive_session_deletion(binding_design):
    seed_cleaned_binding(binding_design)
    with binding_design.begin() as db:
        before = db.execute(
            text(
                "SELECT session_uuid_snapshot,session_generation,operation_kind,attempt_token,published_attempt_token,operation_result,settlement_status FROM gate_physical_operations"
            )
        ).one()
        db.execute(text("DELETE FROM gate_session_bindings"))
        db.execute(text("DELETE FROM gate_sessions"))
        after = db.execute(
            text(
                "SELECT session_uuid_snapshot,session_generation,operation_kind,attempt_token,published_attempt_token,operation_result,settlement_status FROM gate_physical_operations"
            )
        ).one()
        assert (
            before == after
            and db.scalar(text("SELECT session_id FROM gate_physical_operations")) is None
        )
    with (
        pytest.raises(IntegrityError, match="settled result is immutable"),
        binding_design.begin() as db,
    ):
        db.execute(
            text(
                "UPDATE gate_physical_operations SET settlement_status='PENDING',operation_result='NONE',published_attempt_token=NULL"
            )
        )


@pytest.mark.parametrize("domain", ["upload", "avatar", "take"])
def test_terminal_business_generation_cannot_readmit_after_binding_is_gone(binding_design, domain):
    seed_cleaned_binding(binding_design, domain)
    with binding_design.begin() as db:
        old_uuid = db.scalar(text("SELECT session_uuid FROM gate_sessions"))
        db.execute(text("DELETE FROM gate_session_bindings"))
        db.execute(text("DELETE FROM gate_sessions"))
    with (
        pytest.raises(IntegrityError, match="command generation cannot readmit"),
        binding_design.begin() as db,
    ):
        add_binding(db, session_id=3, domain=domain)
    with (
        pytest.raises(IntegrityError, match="monotone and immutable"),
        binding_design.begin() as db,
    ):
        db.execute(
            text(
                f"UPDATE gate_{domain}_generations SET state='OPEN',session_uuid_snapshot=NULL WHERE command_id=1"
            )
        )
    with (
        pytest.raises(IntegrityError, match="lineage survives binding deletion"),
        binding_design.begin() as db,
    ):
        db.execute(text(f"DELETE FROM gate_{domain}_generations WHERE command_id=1"))
    with binding_design.begin() as db:
        db.execute(
            text(
                f"INSERT INTO gate_{domain}_generations(command_id,generation,state) VALUES(1,2,'OPEN')"
            )
        )
        add_binding(db, session_id=3, domain=domain, command_generation=2, session_generation=2)
        rows = db.execute(
            text(
                f"SELECT generation,state,session_uuid_snapshot FROM gate_{domain}_generations WHERE command_id=1 ORDER BY generation"
            )
        ).all()
        assert [(r[0], r[1]) for r in rows] == [(1, "TERMINAL"), (2, "ADMITTED")]
        assert rows[0][2] == old_uuid and rows[1][2] != old_uuid
        assert db.scalar(text("SELECT count(*) FROM gate_sessions WHERE id=1")) == 0


def test_operation_cannot_insert_preapproved_ack(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
    with (
        pytest.raises(IntegrityError, match="operation must start pending"),
        binding_design.begin() as db,
    ):
        db.execute(
            text("""INSERT INTO gate_physical_operations(id,session_id,session_uuid_snapshot,session_generation,operation_kind,attempt_token,published_attempt_token,operation_result,settlement_status)
            SELECT 1,id,session_uuid,generation,'CLEANUP',:token,:token,'CLEANED','SETTLED' FROM gate_sessions"""),
            {"token": uuid4()},
        )


def test_unresolved_evidence_cannot_be_deleted_to_bypass_release_guard(binding_design):
    seed_cleaned_binding(binding_design)
    with binding_design.begin() as db:
        insert_operation(db, id=2, kind="COMPLETE")
    with (
        pytest.raises(IntegrityError, match="requires approved retention"),
        binding_design.begin() as db,
    ):
        db.execute(text("DELETE FROM gate_physical_operations WHERE id=2"))
    with (
        pytest.raises(IntegrityError, match="cleanup must be acknowledged"),
        binding_design.begin() as db,
    ):
        db.execute(text("DELETE FROM gate_session_bindings"))
