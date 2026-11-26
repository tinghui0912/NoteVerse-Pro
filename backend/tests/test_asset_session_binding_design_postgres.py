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
from tests.support.asset_binding_ledger_design import install_physical_ledger_design


@pytest.fixture
def binding_design(postgres_engine):
    with postgres_engine.begin() as db:
        db.execute(
            text("""CREATE TABLE gate_sessions (
            id bigint PRIMARY KEY, user_id bigint NOT NULL, UNIQUE(id,user_id),
            session_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
            generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
            terminal boolean NOT NULL DEFAULT false,
            cleanup_operation_uuid uuid, resources_closed boolean NOT NULL DEFAULT false
        )""")
        )
        db.execute(
            text("""CREATE TABLE gate_physical_operations (
            id bigint PRIMARY KEY, operation_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
            session_id bigint REFERENCES gate_sessions(id) ON DELETE SET NULL,
            session_uuid_snapshot uuid NOT NULL, session_generation integer NOT NULL CHECK(session_generation>0),
            operation_kind text NOT NULL CHECK(operation_kind IN ('INITIATE','COMPLETE','VERIFY','CLEANUP','DISCOVER','COPY')),
            claim_epoch bigint NOT NULL DEFAULT 1 CHECK(claim_epoch>0), attempt_token uuid NOT NULL,
            published_claim_epoch bigint, published_attempt_token uuid,
            operation_result text NOT NULL DEFAULT 'NONE' CHECK(operation_result IN ('NONE','SUCCEEDED','CLEANED','NOT_FOUND')),
            settlement_status text NOT NULL DEFAULT 'PENDING' CHECK(settlement_status IN ('PENDING','UNKNOWN','SETTLED')),
            CHECK((settlement_status='SETTLED' AND operation_result<>'NONE' AND published_attempt_token=attempt_token AND published_attempt_token IS NOT NULL AND published_claim_epoch=claim_epoch AND published_claim_epoch IS NOT NULL)
                OR (settlement_status<>'SETTLED' AND operation_result='NONE' AND published_attempt_token IS NULL AND published_claim_epoch IS NULL)),
            CHECK(operation_result<>'CLEANED' OR operation_kind='CLEANUP'),
            CHECK(operation_kind<>'CLEANUP' OR operation_result IN ('NONE','CLEANED'))
        )""")
        )
        db.execute(
            text(
                "CREATE UNIQUE INDEX gate_single_protocol_phase ON gate_physical_operations(session_uuid_snapshot,session_generation,operation_kind) WHERE operation_kind IN ('INITIATE','COMPLETE','VERIFY','CLEANUP')"
            )
        )
        for name in ("gate_upload_commands", "gate_avatar_commands", "gate_take_reservations"):
            db.execute(
                text(
                    f"CREATE TABLE {name} (id bigint PRIMARY KEY, user_id bigint NOT NULL, completed boolean NOT NULL DEFAULT false, UNIQUE(id,user_id))"
                )
            )
            db.execute(text(f"INSERT INTO {name}(id,user_id) VALUES (1,1),(2,2),(3,1)"))
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
    install_physical_ledger_design(db)
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
    db.execute(text("ALTER TABLE gate_take_generations ADD CHECK(generation=1)"))
    for domain in ("upload", "avatar", "take"):
        db.execute(
            text(
                f"CREATE UNIQUE INDEX gate_{domain}_one_active_generation ON gate_{domain}_generations(command_id) WHERE state='ADMITTED'"
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
      IF OLD.state='ADMITTED' AND NEW.state='TERMINAL' AND EXISTS(SELECT 1 FROM gate_sessions WHERE session_uuid=OLD.session_uuid_snapshot AND NOT terminal) THEN
        RAISE EXCEPTION 'domain generation requires terminal session' USING ERRCODE='23514';
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
        text("""CREATE FUNCTION gate_admission_parent() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE done boolean;
    BEGIN
      IF NEW.upload_command_id IS NOT NULL THEN SELECT completed INTO done FROM gate_upload_commands WHERE id=NEW.upload_command_id FOR UPDATE;
      ELSIF NEW.avatar_command_id IS NOT NULL THEN SELECT completed INTO done FROM gate_avatar_commands WHERE id=NEW.avatar_command_id FOR UPDATE;
      ELSE SELECT completed INTO done FROM gate_take_reservations WHERE id=NEW.take_reservation_id FOR UPDATE;
      END IF;
      IF done THEN RAISE EXCEPTION 'completed command cannot readmit' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$""")
    )
    db.execute(
        text(
            "CREATE TRIGGER gate_admission_parent BEFORE INSERT ON gate_session_bindings FOR EACH ROW EXECUTE FUNCTION gate_admission_parent()"
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
            WHERE command_id=NEW.upload_command_id AND generation=NEW.command_generation AND state='OPEN'
            AND NOT EXISTS(SELECT 1 FROM gate_upload_generations prior WHERE prior.command_id=NEW.upload_command_id AND prior.generation<NEW.command_generation AND prior.state<>'TERMINAL');
        ELSIF NEW.avatar_command_id IS NOT NULL THEN
          UPDATE gate_avatar_generations SET state='ADMITTED',session_uuid_snapshot=session_identity
            WHERE command_id=NEW.avatar_command_id AND generation=NEW.command_generation AND state='OPEN'
            AND NOT EXISTS(SELECT 1 FROM gate_avatar_generations prior WHERE prior.command_id=NEW.avatar_command_id AND prior.generation<NEW.command_generation AND prior.state<>'TERMINAL');
        ELSE
          UPDATE gate_take_generations SET state='ADMITTED',session_uuid_snapshot=session_identity
            WHERE command_id=NEW.take_reservation_id AND generation=NEW.command_generation AND state='OPEN';
        END IF;
        IF NOT FOUND THEN RAISE EXCEPTION 'command generation cannot readmit' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END IF;
      IF OLD.upload_command_id IS NOT NULL THEN
        UPDATE gate_upload_generations SET state='TERMINAL' WHERE command_id=OLD.upload_command_id AND generation=OLD.command_generation AND state='ADMITTED';
      ELSIF OLD.avatar_command_id IS NOT NULL THEN
        UPDATE gate_avatar_generations SET state='TERMINAL' WHERE command_id=OLD.avatar_command_id AND generation=OLD.command_generation AND state='ADMITTED';
      ELSE
        UPDATE gate_take_generations SET state='TERMINAL' WHERE command_id=OLD.take_reservation_id AND generation=OLD.command_generation AND state='ADMITTED';
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
    db,
    *,
    id=1,
    session_id=1,
    uuid=None,
    generation=None,
    kind="CLEANUP",
    token=None,
    register_staging=False,
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
    if (
        register_staging
        and kind == "CLEANUP"
        and (uuid is None or uuid == identity)
        and (generation is None or generation == current_generation)
    ):
        register_resource(db, operation_id=id)
    return token


def claim_operation(db, expected_token, new_token, *, expected_epoch=1, id=1):
    return db.scalar(
        text(
            "SELECT gate_claim_operation(operation_uuid,:epoch,:old,:new) FROM gate_physical_operations WHERE id=:id"
        ),
        {"epoch": expected_epoch, "old": expected_token, "new": new_token, "id": id},
    )


def publish_success(db, *, id, result="SUCCEEDED"):
    db.execute(
        text(
            "SELECT s.id FROM gate_sessions s JOIN gate_physical_operations o ON o.session_id=s.id WHERE o.id=:id FOR NO KEY UPDATE OF s"
        ),
        {"id": id},
    )
    return db.execute(
        text("""UPDATE gate_physical_operations SET published_claim_epoch=claim_epoch,
        published_attempt_token=attempt_token,operation_result=:result,settlement_status='SETTLED'
        WHERE id=:id AND settlement_status<>'SETTLED'"""),
        {"id": id, "result": result},
    ).rowcount


def register_resource(
    db,
    *,
    operation_id=1,
    kind="STAGING_OBJECT",
    key=None,
    upload_id=None,
    version=None,
    physical_generation=None,
    source_id=None,
    provenance="DISCOVERED_BY",
    observation_method=None,
):
    from hashlib import sha256
    import json

    op_uuid, session_id, session_uuid, generation = db.execute(
        text(
            "SELECT operation_uuid,session_id,session_uuid_snapshot,session_generation FROM gate_physical_operations WHERE id=:id"
        ),
        {"id": operation_id},
    ).one()
    resource_uuid = uuid4()
    source_uuid = (
        op_uuid
        if source_id is None
        else db.scalar(
            text("SELECT operation_uuid FROM gate_physical_operations WHERE id=:id"),
            {"id": source_id},
        )
    )
    key = key or f"qualification/{session_uuid}/{generation}/{resource_uuid}"
    physical_generation = physical_generation or uuid4()
    fingerprint = sha256(
        json.dumps(
            [kind, key, upload_id, str(physical_generation), version], separators=(",", ":")
        ).encode()
    ).hexdigest()
    db.execute(
        text("""INSERT INTO gate_physical_resources(resource_uuid,session_id,session_uuid_snapshot,session_generation,cleanup_operation_uuid,source_operation_uuid,provenance_kind,observation_uuid,observation_method,resource_kind,object_key,provider_upload_id,physical_generation,version_id,locator_fingerprint)
      VALUES(:r,:s,:u,:g,:o,:source,:provenance,:observation,:method,:kind,:key,:upload,:pg,:version,:fingerprint)"""),
        {
            "r": resource_uuid,
            "s": session_id,
            "u": session_uuid,
            "g": generation,
            "o": op_uuid,
            "source": source_uuid,
            "provenance": provenance,
            "observation": uuid4(),
            "method": observation_method
            or (
                ("MPU_LIST" if kind == "MPU" else "HEAD")
                if provenance == "DISCOVERED_BY"
                else {
                    "MPU": "INITIATE_RESPONSE",
                    "STAGING_OBJECT": "COMPLETE_RESPONSE",
                    "COPY_CANDIDATE": "COPY_RESPONSE",
                }[kind]
            ),
            "kind": kind,
            "key": key,
            "upload": upload_id,
            "pg": physical_generation,
            "version": version,
            "fingerprint": fingerprint,
        },
    )
    return resource_uuid


def acknowledge_resource(db, resource_uuid, token, *, epoch=1, **overrides):
    row = dict(
        db.execute(
            text("SELECT * FROM gate_physical_resources WHERE resource_uuid=:id"),
            {"id": resource_uuid},
        )
        .mappings()
        .one()
    )
    values = {
        "r": resource_uuid,
        "o": row["cleanup_operation_uuid"],
        "epoch": epoch,
        "token": token,
        "key": row["object_key"],
        "upload": row["provider_upload_id"],
        "pg": row["physical_generation"],
        "version": row["version_id"],
        "kind": row["resource_kind"],
    }
    values.update(overrides)
    db.execute(
        text("""INSERT INTO gate_resource_settlements(resource_uuid,operation_uuid,claim_epoch,attempt_token,resource_kind,object_key,provider_upload_id,physical_generation,version_id)
      VALUES(:r,:o,:epoch,:token,:kind,:key,:upload,:pg,:version)"""),
        values,
    )


def publish_root(db, token, *, id=1, epoch=1):
    db.execute(
        text(
            "SELECT s.id FROM gate_sessions s JOIN gate_physical_operations o ON o.session_id=s.id WHERE o.id=:id FOR NO KEY UPDATE OF s"
        ),
        {"id": id},
    )
    return db.execute(
        text("""UPDATE gate_physical_operations SET published_claim_epoch=:epoch,published_attempt_token=:token,operation_result='CLEANED',settlement_status='SETTLED'
      WHERE id=:id AND claim_epoch=:epoch AND attempt_token=:token AND operation_kind='CLEANUP' AND settlement_status IN ('PENDING','UNKNOWN')"""),
        {"id": id, "epoch": epoch, "token": token},
    ).rowcount


def publish_cleanup(db, token, *, id=1, epoch=1):
    db.execute(
        text(
            "SELECT s.id FROM gate_sessions s JOIN gate_physical_operations o ON o.session_id=s.id WHERE o.id=:id FOR UPDATE OF s"
        ),
        {"id": id},
    )
    current = db.execute(
        text(
            "SELECT session_id,operation_uuid FROM gate_physical_operations WHERE id=:id AND claim_epoch=:e AND attempt_token=:t AND operation_kind='CLEANUP' AND settlement_status<>'SETTLED' FOR UPDATE"
        ),
        {"id": id, "e": epoch, "t": token},
    ).first()
    if current is None:
        return 0
    # Test coordinator explicitly closes a fully registered set; not Provider evidence.
    resources = list(
        db.scalars(
            text(
                "SELECT resource_uuid FROM gate_physical_resources WHERE cleanup_operation_uuid=:o"
            ),
            {"o": current.operation_uuid},
        )
    )
    db.execute(
        text("UPDATE gate_sessions SET resources_closed=true WHERE id=:id"),
        {"id": current.session_id},
    )
    for resource in resources:
        acknowledge_resource(db, resource, token, epoch=epoch)
    return publish_root(db, token, id=id, epoch=epoch)


def record_empty_observation(db, *, operation_id=2, **overrides):
    values = dict(
        db.execute(
            text("""SELECT operation_uuid AS op,session_uuid_snapshot AS u,
        session_generation AS g,claim_epoch AS e,attempt_token AS t
        FROM gate_physical_operations WHERE id=:id"""),
            {"id": operation_id},
        )
        .mappings()
        .one()
    )
    values.update(
        {
            "observation": uuid4(),
            "result": "NOT_FOUND",
            "scope": "EXACT_SESSION_GENERATION",
            "mpus": 0,
            "objects": 0,
        }
    )
    values.update(overrides)
    db.execute(
        text("""INSERT INTO gate_empty_set_observations(observation_uuid,discovery_operation_uuid,
        session_uuid_snapshot,session_generation,claim_epoch,attempt_token,result,observation_scope,mpus_observed,objects_observed)
        VALUES(:observation,:op,:u,:g,:e,:t,:result,:scope,:mpus,:objects)"""),
        values,
    )
    return values["observation"]


def attach_empty_observation(db, observation, *, session_id=1):
    db.execute(
        text("UPDATE gate_sessions SET empty_set_observation_uuid=:o WHERE id=:id"),
        {"o": observation, "id": session_id},
    )


def settle_empty_discovery(db, *, operation_id=2, session_id=1):
    observation = record_empty_observation(db, operation_id=operation_id)
    assert publish_success(db, id=operation_id, result="NOT_FOUND") == 1
    attach_empty_observation(db, observation, session_id=session_id)
    return observation


def seed_cleaned_binding(engine, domain="upload"):
    with engine.begin() as db:
        add_binding(db, domain=domain)
        db.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
        token = insert_operation(db, register_staging=True)
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
        if fault in ("generation", "old_generation", "uuid"):
            with (
                pytest.raises(IntegrityError, match="matching open session identity"),
                db.begin_nested(),
            ):
                insert_operation(
                    db,
                    uuid=uuid4() if fault == "uuid" else None,
                    generation=2
                    if fault == "generation"
                    else (1 if fault == "old_generation" else None),
                )
            assert db.scalar(text("SELECT count(*) FROM gate_physical_operations")) == 0
        elif fault.startswith("kind_"):
            kind = fault.removeprefix("kind_")
            insert_operation(db, kind=kind)
            if kind in ("INITIATE", "COMPLETE"):
                with (
                    pytest.raises(IntegrityError, match="requires resource references"),
                    db.begin_nested(),
                ):
                    publish_success(db, id=1)
            else:
                assert publish_success(db, id=1) == 1
        elif fault != "missing":
            token = insert_operation(db, register_staging=True)
            if fault == "stale_attempt":
                assert claim_operation(db, token, uuid4())
                assert publish_cleanup(db, token) == 0
            else:
                insert_operation(db, id=2, kind="COMPLETE")
                db.execute(
                    text(
                        "UPDATE gate_physical_operations SET settlement_status='UNKNOWN' WHERE id=2"
                    )
                )
                with (
                    pytest.raises(IntegrityError, match="all registered locators"),
                    db.begin_nested(),
                ):
                    publish_cleanup(db, token)
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
        assert claim_operation(db, old, uuid4())
    with (
        pytest.raises(IntegrityError, match="publication must match current attempt"),
        binding_design.begin() as db,
    ):
        db.execute(
            text(
                "UPDATE gate_physical_operations SET published_attempt_token=:old,published_claim_epoch=1,operation_result='CLEANED',settlement_status='SETTLED'"
            ),
            {"old": old},
        )
    with binding_design.connect() as db:
        assert db.scalar(text("SELECT operation_result FROM gate_physical_operations")) == "NONE"


def test_late_attempt_waits_for_rotation_and_cannot_publish_ack(binding_design):
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        old = insert_operation(db, register_staging=True)
    current = uuid4()
    with Session(engine) as takeover, ThreadPoolExecutor(1) as pool:
        owner = takeover.scalar(text("SELECT pg_backend_pid()"))
        assert claim_operation(takeover, old, current)

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
        db.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
        assert publish_cleanup(db, current, epoch=2) == 1


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
    if domain == "take":
        with pytest.raises(IntegrityError), binding_design.begin() as db:
            db.execute(
                text(
                    "INSERT INTO gate_take_generations(command_id,generation,state) VALUES(1,2,'OPEN')"
                )
            )
        with binding_design.begin() as db:
            add_binding(db, session_id=3, domain="take", command_id=3)
            assert (
                db.scalar(
                    text(
                        "SELECT state FROM gate_take_generations WHERE command_id=1 AND generation=1"
                    )
                )
                == "TERMINAL"
            )
        return
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
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db, register_staging=True)
        insert_operation(db, id=2, kind="COMPLETE")
        db.execute(text("UPDATE gate_sessions SET terminal=true"))
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_cleanup(db, token)
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


def prepare_locators(db, *, second_handle=False):
    add_binding(db)
    db.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
    token = insert_operation(db, register_staging=True)
    pg = uuid4()
    first = register_resource(
        db,
        kind="MPU",
        key="qualification/shared-key",
        upload_id="opaque-handle-1",
        physical_generation=pg,
    )
    second = (
        register_resource(
            db,
            kind="MPU",
            key="qualification/shared-key",
            upload_id="opaque-handle-2",
            physical_generation=pg,
        )
        if second_handle
        else None
    )
    db.execute(text("UPDATE gate_sessions SET resources_closed=true WHERE id=1"))
    # The expected complete-object locator must settle independently from MPU handles.
    staging = db.scalar(
        text(
            "SELECT resource_uuid FROM gate_physical_resources WHERE resource_kind='STAGING_OBJECT'"
        )
    )
    acknowledge_resource(db, staging, token)
    return token, first, second


@pytest.mark.parametrize("fault", ["key", "upload", "pg", "o", "version", "r"])
def test_wrong_locator_or_operation_ack_cannot_release_any_original_resource(binding_design, fault):
    with binding_design.begin() as db:
        token, resource, _ = prepare_locators(db)
        bad = {
            "key": "qualification/wrong-key",
            "upload": "different-upload-id",
            "pg": uuid4(),
            "o": uuid4(),
            "version": "wrong-version",
            "r": uuid4(),
        }
        with pytest.raises(IntegrityError, match="ACK must match"), db.begin_nested():
            acknowledge_resource(db, resource, token, **{fault: bad[fault]})
        assert (
            db.scalar(
                text("SELECT count(*) FROM gate_resource_settlements WHERE resource_uuid=:r"),
                {"r": resource},
            )
            == 0
        )
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_root(db, token)
    with (
        pytest.raises(IntegrityError, match="cleanup must be acknowledged"),
        binding_design.begin() as db,
    ):
        db.execute(text("DELETE FROM gate_session_bindings"))


def test_one_handle_ack_cannot_stand_in_for_new_handle_or_another_resource(binding_design):
    with binding_design.begin() as db:
        token, first, second = prepare_locators(db, second_handle=True)
        acknowledge_resource(db, first, token)
        with pytest.raises(IntegrityError, match="ACK must match"), db.begin_nested():
            acknowledge_resource(db, first, token, r=second)
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_root(db, token)
        assert (
            db.scalar(
                text("SELECT count(*) FROM gate_resource_settlements WHERE resource_uuid=:r"),
                {"r": second},
            )
            == 0
        )
        acknowledge_resource(db, second, token)
        assert publish_root(db, token) == 1
        before = db.execute(
            text(
                "SELECT resource_uuid,object_key,provider_upload_id,physical_generation,version_id,cleanup_operation_uuid FROM gate_physical_resources ORDER BY resource_uuid"
            )
        ).all()
        with pytest.raises(RuntimeError), db.begin_nested():
            db.execute(text("DELETE FROM gate_session_bindings"))
            raise RuntimeError("injected before session deletion")
        assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 1
        db.execute(text("DELETE FROM gate_session_bindings"))
        db.execute(text("DELETE FROM gate_sessions"))
        after = db.execute(
            text(
                "SELECT resource_uuid,object_key,provider_upload_id,physical_generation,version_id,cleanup_operation_uuid FROM gate_physical_resources ORDER BY resource_uuid"
            )
        ).all()
        assert before == after
        assert (
            db.scalar(
                text("SELECT count(*) FROM gate_physical_resources WHERE session_id IS NOT NULL")
            )
            == 0
        )


@pytest.mark.parametrize(
    "field",
    [
        "resource_uuid",
        "object_key",
        "provider_upload_id",
        "physical_generation",
        "version_id",
        "resource_kind",
        "cleanup_operation_uuid",
        "source_operation_uuid",
        "provenance_kind",
        "observation_uuid",
        "observation_method",
        "session_uuid_snapshot",
        "session_generation",
        "locator_fingerprint",
        "session_id",
    ],
)
@pytest.mark.parametrize("settled", [False, True])
def test_registered_locator_is_immutable_before_and_after_settlement(
    binding_design, field, settled
):
    with binding_design.begin() as db:
        token, resource, _ = prepare_locators(db)
        if settled:
            acknowledge_resource(db, resource, token)
            assert publish_root(db, token) == 1
    values = {
        "resource_uuid": uuid4(),
        "object_key": "qualification/other",
        "provider_upload_id": "new-handle",
        "physical_generation": uuid4(),
        "version_id": "new-version",
        "resource_kind": "COPY_CANDIDATE",
        "cleanup_operation_uuid": uuid4(),
        "source_operation_uuid": uuid4(),
        "provenance_kind": "CREATED_BY",
        "observation_uuid": uuid4(),
        "observation_method": "INITIATE_RESPONSE",
        "session_uuid_snapshot": uuid4(),
        "session_generation": 2,
        "locator_fingerprint": "f" * 64,
        "session_id": 2,
    }
    with (
        pytest.raises(IntegrityError, match="physical locator is immutable"),
        binding_design.begin() as db,
    ):
        db.execute(
            text(f"UPDATE gate_physical_resources SET {field}=:value WHERE resource_uuid=:r"),
            {"value": values[field], "r": resource},
        )


@pytest.mark.parametrize(
    "change",
    [
        "attempt_token=gen_random_uuid()",
        "claim_epoch=claim_epoch+1",
        "published_attempt_token=gen_random_uuid()",
        "published_claim_epoch=2",
        "operation_result='NONE'",
        "settlement_status='PENDING'",
        "operation_uuid=gen_random_uuid()",
    ],
)
def test_settled_operation_rejects_all_claim_result_and_identity_mutations(binding_design, change):
    seed_cleaned_binding(binding_design)
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        db.execute(text("UPDATE gate_physical_operations SET " + change))


def test_copy_candidate_version_is_bound_and_fingerprint_is_not_cleanup_authority(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        db.execute(text("UPDATE gate_sessions SET terminal=true"))
        token = insert_operation(db, register_staging=True)
        candidate = register_resource(db, kind="COPY_CANDIDATE", version="version-1")
        db.execute(text("UPDATE gate_sessions SET resources_closed=true"))
        with pytest.raises(IntegrityError, match="ACK must match"), db.begin_nested():
            acknowledge_resource(db, candidate, token, version="version-2")
        acknowledge_resource(db, candidate, token)
        safe = db.execute(
            text(
                "SELECT resource_uuid,resource_kind,locator_fingerprint FROM gate_physical_resources WHERE resource_uuid=:r"
            ),
            {"r": candidate},
        ).one()
        assert len(safe.locator_fingerprint) == 64


@pytest.fixture
def ledger_roles(binding_design):
    coordinator, worker = "gate_coordinator_" + uuid4().hex, "gate_worker_" + uuid4().hex
    with binding_design.begin() as db:
        schema = db.scalar(text("SELECT current_schema()"))
        for role in (coordinator, worker):
            db.execute(text(f'CREATE ROLE "{role}" NOLOGIN'))
            db.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"'))
        db.execute(
            text(
                f'GRANT SELECT(id,operation_uuid,claim_epoch,attempt_token,settlement_status) ON gate_physical_operations TO "{coordinator}"'
            )
        )
        for function in (
            "gate_claim_operation(uuid,bigint,uuid,uuid)",
            "gate_assign_worker(uuid,bigint,uuid,name)",
        ):
            db.execute(text(f'GRANT EXECUTE ON FUNCTION {function} TO "{coordinator}"'))
        for function in (
            "gate_worker_publish(uuid,bigint,uuid,text)",
            "gate_worker_ack(uuid,uuid,bigint,uuid,text,text,text,uuid,text)",
        ):
            db.execute(text(f'GRANT EXECUTE ON FUNCTION {function} TO "{worker}"'))
    try:
        yield coordinator, worker
    finally:
        with binding_design.begin() as db:
            for role in (coordinator, worker):
                db.execute(text(f'DROP OWNED BY "{role}"'))
                db.execute(text(f'DROP ROLE "{role}"'))


def assign_worker(db, operation_uuid, epoch, token, worker):
    return db.scalar(
        text("SELECT gate_assign_worker(:o,:e,:t,:w)"),
        {"o": operation_uuid, "e": epoch, "t": token, "w": worker},
    )


def worker_publish(db, operation_uuid, epoch, token, result="CLEANED"):
    return db.scalar(
        text("SELECT gate_worker_publish(:o,:e,:t,:r)"),
        {"o": operation_uuid, "e": epoch, "t": token, "r": result},
    )


def worker_ack(db, resource, epoch, token):
    return db.scalar(
        text("SELECT gate_worker_ack(:r,:o,:e,:t,:kind,:key,:upload,:g,:version)"),
        {
            "r": resource["resource_uuid"],
            "o": resource["cleanup_operation_uuid"],
            "e": epoch,
            "t": token,
            "kind": resource["resource_kind"],
            "key": resource["object_key"],
            "upload": resource["provider_upload_id"],
            "g": resource["physical_generation"],
            "version": resource["version_id"],
        },
    )


def test_two_step_old_token_reset_is_rejected_and_correct_epoch_can_publish(
    binding_design, ledger_roles
):
    from sqlalchemy.exc import ProgrammingError

    coordinator, worker = ledger_roles
    with binding_design.begin() as db:
        token, resource, _ = prepare_locators(db)
        next_token = uuid4()
        operation_uuid = db.scalar(text("SELECT operation_uuid FROM gate_physical_operations"))
        resources = list(db.execute(text("SELECT * FROM gate_physical_resources")).mappings())
        db.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
        assert assign_worker(db, operation_uuid, 1, token, worker)
        assert claim_operation(db, token, next_token)
        assert assign_worker(db, operation_uuid, 2, next_token, worker)
    # Even the schema owner cannot reset T2 to T1 by ordinary UPDATE or CAS reuse.
    for change in ("attempt_token=:old", "attempt_token=:old,claim_epoch=3"):
        with pytest.raises(IntegrityError, match="monotonic CAS"), binding_design.begin() as db:
            db.execute(text("UPDATE gate_physical_operations SET " + change), {"old": token})
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        claim_operation(db, next_token, token, expected_epoch=2)
    with pytest.raises(ProgrammingError), binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{worker}"'))
        db.execute(text("UPDATE gate_physical_operations SET attempt_token=:old"), {"old": token})
        # This second UPDATE is unreachable after the privilege rejection.
        publish_root(db, token)
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{worker}"'))
        assert worker_publish(db, operation_uuid, 1, token) is False
        assert worker_ack(db, resources[0], 1, token) is False
        for facts in resources:
            # prepare_locators already acknowledged staging under epoch 1; epoch 2 needs fresh evidence.
            assert worker_ack(db, facts, 2, next_token) is True
        assert worker_publish(db, operation_uuid, 2, next_token) is True
    with binding_design.connect() as db:
        assert db.execute(
            text(
                "SELECT claim_epoch,attempt_token,published_claim_epoch,published_attempt_token FROM gate_physical_operations"
            )
        ).one() == (2, next_token, 2, next_token)


def test_concurrent_claim_cas_has_one_winner_and_no_token_reactivation(
    binding_design, ledger_roles
):
    coordinator, _ = ledger_roles
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        original = insert_operation(db)
    next_token = uuid4()
    with Session(engine) as first, ThreadPoolExecutor(1) as pool:
        first.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
        owner = first.scalar(text("SELECT pg_backend_pid()"))
        assert claim_operation(first, original, next_token)

        def compete():
            with Session(engine) as other:
                other.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
                ready.put(other.scalar(text("SELECT pg_backend_pid()")))
                result = claim_operation(other, original, uuid4())
                other.commit()
                return result

        second = pool.submit(compete)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            first.commit()
        assert second.result(timeout=10) is False
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_operation_claims")) == 2
        assert db.scalar(text("SELECT attempt_token FROM gate_physical_operations")) == next_token


@pytest.mark.parametrize("domain", ["upload", "avatar", "take"])
def test_active_generation_blocks_next_generation_and_terminal_policy_is_domain_specific(
    binding_design, domain
):
    with binding_design.begin() as db:
        add_binding(db, domain=domain)
    if domain == "take":
        with pytest.raises(IntegrityError), binding_design.begin() as db:
            db.execute(
                text(
                    "INSERT INTO gate_take_generations(command_id,generation,state) VALUES(1,2,'OPEN')"
                )
            )
        return
    with binding_design.begin() as db:
        db.execute(
            text(
                f"INSERT INTO gate_{domain}_generations(command_id,generation,state) VALUES(1,2,'OPEN')"
            )
        )
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        add_binding(db, session_id=3, domain=domain, command_generation=2, session_generation=2)
    with binding_design.begin() as db:
        db.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
        db.execute(
            text(
                f"UPDATE gate_{domain}_generations SET state='TERMINAL' WHERE command_id=1 AND generation=1"
            )
        )
        add_binding(db, session_id=3, domain=domain, command_generation=2, session_generation=2)
        assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 2
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        add_binding(db, session_id=4, domain=domain, command_generation=1)
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        add_binding(db, session_id=4, domain=domain, command_generation=2)


@pytest.mark.parametrize("domain", ["upload", "avatar"])
def test_completed_business_command_cannot_create_next_transport_generation(binding_design, domain):
    with binding_design.begin() as db:
        add_binding(db, domain=domain)
        db.execute(text("UPDATE gate_sessions SET terminal=true"))
        db.execute(
            text(f"UPDATE gate_{domain}_generations SET state='TERMINAL' WHERE command_id=1")
        )
        commands = "gate_upload_commands" if domain == "upload" else "gate_avatar_commands"
        db.execute(text(f"UPDATE {commands} SET completed=true WHERE id=1"))
        db.execute(
            text(
                f"INSERT INTO gate_{domain}_generations(command_id,generation,state) VALUES(1,2,'OPEN')"
            )
        )
    with (
        pytest.raises(IntegrityError, match="completed command cannot readmit"),
        binding_design.begin() as db,
    ):
        add_binding(db, session_id=3, domain=domain, command_generation=2)


@pytest.mark.parametrize("domain", ["upload", "avatar", "take"])
def test_different_generations_concurrently_cannot_create_two_active_sessions(
    binding_design, domain
):
    engine, ready = binding_design, Queue()
    if domain != "take":
        with engine.begin() as db:
            db.execute(
                text(
                    f"INSERT INTO gate_{domain}_generations(command_id,generation,state) VALUES(1,2,'OPEN')"
                )
            )
    with Session(engine) as first, ThreadPoolExecutor(1) as pool:
        owner = first.scalar(text("SELECT pg_backend_pid()"))
        add_binding(first, domain=domain)

        def next_generation():
            with Session(engine) as other:
                ready.put(other.scalar(text("SELECT pg_backend_pid()")))
                with pytest.raises(IntegrityError):
                    if domain == "take":
                        other.execute(
                            text(
                                "INSERT INTO gate_take_generations(command_id,generation,state) VALUES(1,2,'OPEN')"
                            )
                        )
                    else:
                        add_binding(
                            other,
                            session_id=3,
                            domain=domain,
                            command_generation=2,
                            session_generation=2,
                        )
                other.rollback()

        competing = pool.submit(next_generation)
        try:
            pid = ready.get(timeout=10)
            if domain != "take":
                wait_for_blocker(engine, owner, pid)
            else:
                competing.result(timeout=10)
        finally:
            first.commit()
        competing.result(timeout=10)
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 1
        assert (
            db.scalar(
                text(f"SELECT count(*) FROM gate_{domain}_generations WHERE state='ADMITTED'")
            )
            == 1
        )


@pytest.mark.parametrize("kind", ["INITIATE", "COMPLETE", "VERIFY", "CLEANUP", "DISCOVER", "COPY"])
@pytest.mark.parametrize("fault", ["uuid", "generation", "id", "none"])
def test_operation_insert_requires_exact_session_identity(binding_design, kind, fault):
    with binding_design.begin() as db:
        add_binding(db)
        add_binding(db, session_id=2, user_id=2, command_id=2)
        original = db.scalar(text("SELECT session_uuid FROM gate_sessions WHERE id=1"))
        if fault == "none":
            insert_operation(db, kind=kind)
            assert db.scalar(text("SELECT count(*) FROM gate_operation_claims")) == 1
            pointer = db.scalar(text("SELECT cleanup_operation_uuid FROM gate_sessions WHERE id=1"))
            assert (pointer is not None) == (kind == "CLEANUP")
        else:
            with (
                pytest.raises(IntegrityError, match="matching open session identity"),
                db.begin_nested(),
            ):
                insert_operation(
                    db,
                    kind=kind,
                    session_id=2 if fault == "id" else 1,
                    uuid=uuid4() if fault == "uuid" else original,
                    generation=2 if fault == "generation" else 1,
                )
            assert db.scalar(text("SELECT count(*) FROM gate_physical_operations")) == 0
            assert db.scalar(text("SELECT count(*) FROM gate_operation_claims")) == 0
            assert (
                db.scalar(
                    text(
                        "SELECT count(*) FROM gate_sessions WHERE cleanup_operation_uuid IS NOT NULL"
                    )
                )
                == 0
            )
            # No malformed operation row exists to publish a later successful result.
            assert publish_success(db, id=1) == 0


def test_resource_registration_wins_and_closure_observes_committed_resource(binding_design):
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        token = insert_operation(db, register_staging=True)
    with Session(engine) as registering, ThreadPoolExecutor(1) as pool:
        owner = registering.scalar(text("SELECT pg_backend_pid()"))
        late = register_resource(registering, kind="MPU", upload_id="registered-before-close")

        def close_and_settle():
            with Session(engine) as closing:
                ready.put(closing.scalar(text("SELECT pg_backend_pid()")))
                closing.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
                closing.execute(text("UPDATE gate_sessions SET resources_closed=true WHERE id=1"))
                resources = list(
                    closing.scalars(text("SELECT resource_uuid FROM gate_physical_resources"))
                )
                assert late in resources
                for rid in resources:
                    if rid != late:
                        acknowledge_resource(closing, rid, token)
                with (
                    pytest.raises(IntegrityError, match="all registered locators"),
                    closing.begin_nested(),
                ):
                    publish_root(closing, token)
                acknowledge_resource(closing, late, token)
                assert publish_root(closing, token) == 1
                closing.execute(text("DELETE FROM gate_session_bindings"))
                closing.execute(text("DELETE FROM gate_sessions"))
                closing.commit()
                return resources

        contender = pool.submit(close_and_settle)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            registering.commit()
        assert len(contender.result(timeout=10)) == 2
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_resource_settlements")) == 2
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 0


def test_resource_closure_wins_and_late_registration_is_rejected(binding_design):
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        token = insert_operation(db, register_staging=True)
    with Session(engine) as closing, ThreadPoolExecutor(1) as pool:
        owner = closing.scalar(text("SELECT pg_backend_pid()"))
        closing.execute(text("UPDATE gate_sessions SET terminal=true WHERE id=1"))
        closing.execute(text("UPDATE gate_sessions SET resources_closed=true WHERE id=1"))
        for rid in closing.scalars(text("SELECT resource_uuid FROM gate_physical_resources")):
            acknowledge_resource(closing, rid, token)
        assert publish_root(closing, token) == 1

        def register_after_close():
            with Session(engine) as registering:
                ready.put(registering.scalar(text("SELECT pg_backend_pid()")))
                with (
                    pytest.raises(IntegrityError, match="registration identity or fence"),
                    registering.begin_nested(),
                ):
                    register_resource(registering, kind="MPU", upload_id="late-handle")
                registering.commit()

        contender = pool.submit(register_after_close)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            closing.commit()
        contender.result(timeout=10)
    with engine.begin() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_physical_resources")) == 1
        assert (
            db.scalar(text("SELECT settlement_status FROM gate_physical_operations")) == "SETTLED"
        )
        db.execute(text("DELETE FROM gate_session_bindings"))
        db.execute(text("DELETE FROM gate_sessions"))


@pytest.mark.parametrize("kind", ["INITIATE", "COMPLETE", "VERIFY", "CLEANUP", "DISCOVER", "COPY"])
def test_closed_resource_set_rejects_new_operations(binding_design, kind):
    seed_cleaned_binding(binding_design)
    with pytest.raises(IntegrityError), binding_design.begin() as db:
        insert_operation(db, id=2, kind=kind)


@pytest.mark.parametrize(
    "kind,resource_kind",
    [
        ("INITIATE", "MPU"),
        ("COMPLETE", "STAGING_OBJECT"),
        ("COPY", "COPY_CANDIDATE"),
        ("DISCOVER", "MPU"),
    ],
)
def test_successful_physical_operation_requires_correct_resource_provenance(
    binding_design, kind, resource_kind
):
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db, register_staging=True)
        insert_operation(db, id=2, kind=kind)
        with pytest.raises(IntegrityError, match="requires resource references"), db.begin_nested():
            publish_success(db, id=2)
        resources = [
            register_resource(
                db,
                kind=resource_kind,
                upload_id="handle-" + str(i) if resource_kind == "MPU" else None,
                source_id=2,
                provenance="DISCOVERED_BY" if kind == "DISCOVER" else "CREATED_BY",
            )
            for i in range(2)
        ]
        assert len(set(resources)) == 2
        assert publish_success(db, id=2) == 1
        assert (
            db.scalar(
                text(
                    "SELECT count(*) FROM gate_physical_resources WHERE source_operation_uuid=(SELECT operation_uuid FROM gate_physical_operations WHERE id=2)"
                )
            )
            == 2
        )
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        for rid in db.scalars(text("SELECT resource_uuid FROM gate_physical_resources")):
            if rid != resources[-1]:
                acknowledge_resource(db, rid, token)
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_root(db, token)
        acknowledge_resource(db, resources[-1], token)
        assert publish_root(db, token) == 1


@pytest.mark.parametrize("fault", ["session", "kind", "relation", "settled", "method"])
def test_resource_provenance_rejects_wrong_source_operation(binding_design, fault):
    with binding_design.begin() as db:
        add_binding(db)
        insert_operation(db, register_staging=True)
        if fault == "session":
            add_binding(db, session_id=2, user_id=2, command_id=2)
        insert_operation(
            db,
            id=2,
            session_id=2 if fault == "session" else 1,
            kind="VERIFY" if fault == "kind" else "INITIATE",
        )
        if fault == "settled":
            register_resource(
                db, kind="MPU", upload_id="first", source_id=2, provenance="CREATED_BY"
            )
            publish_success(db, id=2)
        with (
            pytest.raises(IntegrityError, match="matching live operation provenance"),
            db.begin_nested(),
        ):
            register_resource(
                db,
                kind="MPU",
                upload_id="wrong-source",
                source_id=2,
                provenance="DISCOVERED_BY" if fault == "relation" else "CREATED_BY",
                observation_method="MPU_LIST" if fault == "method" else None,
            )


def test_unknown_initiate_discovery_does_not_forge_creation_success(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db, register_staging=True)
        insert_operation(db, id=2, kind="INITIATE")
        db.execute(
            text("UPDATE gate_physical_operations SET settlement_status='UNKNOWN' WHERE id=2")
        )
        for operation_id in (3, 4):
            insert_operation(db, id=operation_id, kind="DISCOVER")
            register_resource(
                db, kind="MPU", upload_id=f"discovered-{operation_id}", source_id=operation_id
            )
            assert publish_success(db, id=operation_id) == 1
        # The original unknown request still has a recoverable owner; discovery is not its success.
        assert db.execute(
            text(
                "SELECT settlement_status,operation_result FROM gate_physical_operations WHERE id=2"
            )
        ).one() == ("UNKNOWN", "NONE")
        assert (
            db.scalar(
                text(
                    "SELECT count(DISTINCT source_operation_uuid) FROM gate_physical_resources WHERE resource_kind='MPU'"
                )
            )
            == 2
        )
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_cleanup(db, token)


def test_read_only_verification_and_empty_discovery_have_explicit_results(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        insert_operation(db, id=1, kind="VERIFY")
        insert_operation(db, id=2, kind="DISCOVER")
        insert_operation(db, id=3, kind="INITIATE")
        assert publish_success(db, id=1) == 1
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        record_empty_observation(db, operation_id=2)
        assert publish_success(db, id=2, result="NOT_FOUND") == 1
        with pytest.raises(IntegrityError, match="empty discovery"), db.begin_nested():
            publish_success(db, id=3, result="NOT_FOUND")


@pytest.mark.parametrize(
    "query",
    [
        "SELECT attempt_token FROM gate_physical_operations",
        "SELECT attempt_token FROM gate_operation_claims",
        "SELECT * FROM gate_worker_claim_grants",
        "SELECT * FROM gate_resource_settlements",
    ],
)
def test_provider_worker_cannot_read_unassigned_ledger(binding_design, ledger_roles, query):
    from sqlalchemy.exc import ProgrammingError

    _, worker = ledger_roles
    with pytest.raises(ProgrammingError), binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{worker}"'))
        db.execute(text(query))


def test_worker_claim_authority_is_separate_from_fencing(binding_design, ledger_roles):
    from sqlalchemy.exc import ProgrammingError

    coordinator, worker = ledger_roles
    with binding_design.begin() as db:
        token, _, _ = prepare_locators(db)
        op = db.scalar(text("SELECT operation_uuid FROM gate_physical_operations"))
        resources = list(db.execute(text("SELECT * FROM gate_physical_resources")).mappings())
    # Knowing the real token still grants no claim or publication permission.
    for sql, params in [
        ("SELECT gate_claim_operation(:o,1,:t,:new)", {"o": op, "t": token, "new": uuid4()}),
        ("UPDATE gate_physical_operations SET claim_epoch=2,attempt_token=:t", {"t": uuid4()}),
        ("SELECT gate_assign_worker(:o,1,:t,:w)", {"o": op, "t": token, "w": worker}),
        ("SELECT gate_worker_publish(:o,1,:t,'CLEANED')", {"o": op, "t": token}),
    ]:
        with pytest.raises(ProgrammingError), binding_design.begin() as db:
            db.execute(text(f'SET LOCAL ROLE "{worker}"'))
            db.execute(text(sql), params)
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
        assert assign_worker(db, op, 1, token, worker)
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{worker}"'))
        for facts in resources:
            if facts["resource_kind"] == "MPU":
                assert worker_ack(db, facts, 1, token)
        assert worker_publish(db, op, 1, token)
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
        assert claim_operation(db, token, uuid4()) is False
        assert assign_worker(db, op, 1, token, worker) is False


def test_immutable_settlement_history_and_fk_null_cannot_change_locator(binding_design):
    seed_cleaned_binding(binding_design)
    with binding_design.begin() as db:
        with pytest.raises(IntegrityError, match="immutable"), db.begin_nested():
            db.execute(text("DELETE FROM gate_resource_settlements"))
        # Inject an attempted co-mutation during the actual FK SET NULL path.
        db.execute(
            text("""CREATE FUNCTION gate_corrupt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.session_id IS NULL THEN NEW.object_key='changed-during-unlink'; END IF; RETURN NEW; END $$""")
        )
        db.execute(
            text(
                "CREATE TRIGGER aaa_corrupt_snapshot BEFORE UPDATE ON gate_physical_resources FOR EACH ROW EXECUTE FUNCTION gate_corrupt_snapshot()"
            )
        )
        with (
            pytest.raises(IntegrityError, match="physical locator is immutable"),
            db.begin_nested(),
        ):
            db.execute(text("DELETE FROM gate_session_bindings"))
            db.execute(text("DELETE FROM gate_sessions"))
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 1
        assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 1


@pytest.mark.parametrize("fault", ["uuid", "generation"])
def test_resource_insert_rejects_wrong_session_snapshot(binding_design, fault):
    with binding_design.begin() as db:
        add_binding(db)
        insert_operation(db, register_staging=True)
        with (
            pytest.raises(IntegrityError, match="registration identity or fence"),
            db.begin_nested(),
        ):
            db.execute(
                text("""INSERT INTO gate_physical_resources(resource_uuid,session_id,session_uuid_snapshot,
                session_generation,cleanup_operation_uuid,source_operation_uuid,provenance_kind,observation_uuid,
                observation_method,resource_kind,object_key,provider_upload_id,physical_generation,version_id,locator_fingerprint)
                SELECT gen_random_uuid(),session_id,CASE WHEN :fault='uuid' THEN gen_random_uuid() ELSE session_uuid_snapshot END,
                  CASE WHEN :fault='generation' THEN session_generation+1 ELSE session_generation END,
                  cleanup_operation_uuid,source_operation_uuid,provenance_kind,gen_random_uuid(),observation_method,
                  resource_kind,'wrong-session-key',provider_upload_id,physical_generation,version_id,locator_fingerprint
                FROM gate_physical_resources"""),
                {"fault": fault},
            )
        assert db.scalar(text("SELECT count(*) FROM gate_physical_resources")) == 1


@pytest.mark.parametrize("isolation", ["REPEATABLE READ", "SERIALIZABLE"])
@pytest.mark.parametrize("action", ["register", "close"])
def test_registration_closure_rejects_unproved_snapshot_isolation(
    binding_design, isolation, action
):
    with binding_design.begin() as db:
        add_binding(db)
        insert_operation(db, register_staging=True)
    with binding_design.begin() as db:
        db.execute(text("SET TRANSACTION ISOLATION LEVEL " + isolation))
        with pytest.raises(IntegrityError, match="READ COMMITTED isolation"), db.begin_nested():
            if action == "register":
                register_resource(db, kind="MPU", upload_id="different-snapshot")
            else:
                db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))


@pytest.fixture
def exclusive_roles(binding_design, ledger_roles):
    coordinator_a, worker_a = ledger_roles
    coordinator_b, worker_b = "gate_coordinator_" + uuid4().hex, "gate_worker_" + uuid4().hex
    with binding_design.begin() as db:
        schema = db.scalar(text("SELECT current_schema()"))
        for role in (coordinator_b, worker_b):
            db.execute(text(f'CREATE ROLE "{role}" NOLOGIN'))
            db.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"'))
        db.execute(
            text(
                f'GRANT SELECT(id,operation_uuid,claim_epoch,attempt_token,settlement_status) ON gate_physical_operations TO "{coordinator_b}"'
            )
        )
        for function in (
            "gate_claim_operation(uuid,bigint,uuid,uuid)",
            "gate_assign_worker(uuid,bigint,uuid,name)",
        ):
            db.execute(text(f'GRANT EXECUTE ON FUNCTION {function} TO "{coordinator_b}"'))
        for function in (
            "gate_worker_publish(uuid,bigint,uuid,text)",
            "gate_worker_ack(uuid,uuid,bigint,uuid,text,text,text,uuid,text)",
        ):
            db.execute(text(f'GRANT EXECUTE ON FUNCTION {function} TO "{worker_b}"'))
    try:
        yield coordinator_a, coordinator_b, worker_a, worker_b
    finally:
        with binding_design.begin() as db:
            for role in (coordinator_b, worker_b):
                db.execute(text(f'DROP OWNED BY "{role}"'))
                db.execute(text(f'DROP ROLE "{role}"'))


def advance_claim_to(db, token, epoch):
    for previous in range(1, epoch):
        successor = uuid4()
        assert claim_operation(db, token, successor, expected_epoch=previous)
        token = successor
    return token


@pytest.mark.parametrize("winner", [0, 1])
def test_assignment_competition_has_one_exclusive_worker_principal(
    binding_design, exclusive_roles, winner
):
    from sqlalchemy.exc import ProgrammingError

    ca, cb, wa, wb = exclusive_roles
    coordinators, workers = (ca, cb), (wa, wb)
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        token = insert_operation(db)
        operation = db.scalar(text("SELECT operation_uuid FROM gate_physical_operations"))
        db.execute(text(f'SET LOCAL ROLE "{ca}"'))
        token = advance_claim_to(db, token, 5)
    with Session(engine) as first, ThreadPoolExecutor(1) as pool:
        first.execute(text(f'SET LOCAL ROLE "{coordinators[winner]}"'))
        owner = first.scalar(text("SELECT pg_backend_pid()"))
        assert assign_worker(first, operation, 5, token, workers[winner])
        assert assign_worker(
            first, operation, 5, token, workers[winner]
        )  # Idempotent same principal.

        def competing_assignment():
            with Session(engine) as second:
                second.execute(text(f'SET LOCAL ROLE "{coordinators[1 - winner]}"'))
                ready.put(second.scalar(text("SELECT pg_backend_pid()")))
                result = assign_worker(second, operation, 5, token, workers[1 - winner])
                second.commit()
                return result

        contender = pool.submit(competing_assignment)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            first.commit()
        assert contender.result(timeout=10) is False
    with engine.connect() as db:
        assert db.execute(
            text("SELECT worker_role,claim_epoch,attempt_token FROM gate_worker_claim_grants")
        ).one() == (workers[winner], 5, token)
    with pytest.raises(IntegrityError), engine.begin() as db:
        db.execute(
            text("INSERT INTO gate_worker_claim_grants VALUES(:w,:o,5,:t)"),
            {"w": workers[1 - winner], "o": operation, "t": token},
        )
    with pytest.raises(ProgrammingError), engine.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{workers[1 - winner]}"'))
        worker_publish(db, operation, 5, token)
    with pytest.raises(ProgrammingError), engine.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{workers[winner]}"'))
        db.execute(
            text("INSERT INTO gate_worker_claim_grants VALUES(:w,:o,5,:t)"),
            {"w": workers[winner], "o": operation, "t": token},
        )


@pytest.mark.parametrize("winner", [0, 1])
def test_two_authorized_coordinators_claim_one_new_epoch(binding_design, exclusive_roles, winner):
    ca, cb, _, _ = exclusive_roles
    roles = (ca, cb)
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        token = insert_operation(db)
    next_token = uuid4()
    with Session(engine) as first, ThreadPoolExecutor(1) as pool:
        first.execute(text(f'SET LOCAL ROLE "{roles[winner]}"'))
        owner = first.scalar(text("SELECT pg_backend_pid()"))
        assert claim_operation(first, token, next_token)

        def compete():
            with Session(engine) as second:
                second.execute(text(f'SET LOCAL ROLE "{roles[1 - winner]}"'))
                ready.put(second.scalar(text("SELECT pg_backend_pid()")))
                result = claim_operation(second, token, uuid4())
                second.commit()
                return result

        contender = pool.submit(compete)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
        finally:
            first.commit()
        assert contender.result(timeout=10) is False
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_operation_claims")) == 2
        assert db.scalar(text("SELECT attempt_token FROM gate_physical_operations")) == next_token


def test_exclusive_epoch_five_to_six_takeover_preserves_assignments(
    binding_design, exclusive_roles
):
    from sqlalchemy.exc import ProgrammingError

    ca, cb, wa, wb = exclusive_roles
    with binding_design.begin() as db:
        original, _, _ = prepare_locators(db)
        operation = db.scalar(text("SELECT operation_uuid FROM gate_physical_operations"))
        resources = list(db.execute(text("SELECT * FROM gate_physical_resources")).mappings())
        db.execute(text(f'SET LOCAL ROLE "{ca}"'))
        fifth = advance_claim_to(db, original, 5)
        assert assign_worker(db, operation, 5, fifth, wa)
        assert assign_worker(db, operation, 5, fifth, wa)
        assert assign_worker(db, operation, 5, fifth, wb) is False
    sixth = uuid4()
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{cb}"'))
        assert claim_operation(db, fifth, sixth, expected_epoch=5)
        assert assign_worker(db, operation, 6, sixth, wb)
        assert assign_worker(db, operation, 5, fifth, wb) is False
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{wa}"'))
        assert worker_publish(db, operation, 5, fifth) is False
        assert worker_ack(db, resources[0], 5, fifth) is False
    with pytest.raises(ProgrammingError), binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{wa}"'))
        worker_publish(db, operation, 6, sixth)
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{wb}"'))
        for resource in resources:
            assert worker_ack(db, resource, 6, sixth)
        assert worker_publish(db, operation, 6, sixth)
    for statement in (
        "UPDATE gate_worker_claim_grants SET worker_role='replacement'",
        "UPDATE gate_worker_claim_grants SET claim_epoch=claim_epoch+1",
        "DELETE FROM gate_worker_claim_grants",
    ):
        with pytest.raises(IntegrityError, match="immutable"), binding_design.begin() as db:
            db.execute(text(statement))
    with binding_design.connect() as db:
        assert db.execute(
            text(
                "SELECT claim_epoch,worker_role FROM gate_worker_claim_grants ORDER BY claim_epoch"
            )
        ).all() == [(5, wa), (6, wb)]
        assert db.scalar(text("SELECT published_claim_epoch FROM gate_physical_operations")) == 6


@pytest.mark.parametrize(
    "case",
    [
        "complete",
        "missing",
        "unsettled_discovery",
        "unknown_initiate",
        "unknown_complete",
        "unknown_copy",
    ],
)
def test_truly_empty_resource_set_requires_explicit_settled_discovery(binding_design, case):
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db)  # No implicit resource.
        if case != "missing":
            insert_operation(db, id=2, kind="DISCOVER")
        if case.startswith("unknown_"):
            insert_operation(db, id=3, kind=case.removeprefix("unknown_").upper())
            db.execute(
                text("UPDATE gate_physical_operations SET settlement_status='UNKNOWN' WHERE id=3")
            )
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        assert db.scalar(text("SELECT count(*) FROM gate_physical_resources")) == 0
        if case not in ("missing", "unsettled_discovery"):
            observation = settle_empty_discovery(db)
        elif case == "unsettled_discovery":
            observation = record_empty_observation(db)
            with pytest.raises(IntegrityError, match="pointer identity"), db.begin_nested():
                attach_empty_observation(db, observation)
        if case == "complete":
            assert publish_root(db, token) == 1
            with (
                pytest.raises(IntegrityError, match="registration identity or fence"),
                db.begin_nested(),
            ):
                register_resource(db, kind="MPU", upload_id="too-late")
            db.execute(text("DELETE FROM gate_session_bindings"))
            db.execute(text("DELETE FROM gate_sessions"))
            assert (
                db.scalar(text("SELECT observation_uuid FROM gate_empty_set_observations"))
                == observation
            )
            assert db.scalar(text("SELECT count(*) FROM gate_resource_settlements")) == 0
        else:
            with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
                publish_root(db, token)
            with (
                pytest.raises(IntegrityError, match="cleanup must be acknowledged"),
                db.begin_nested(),
            ):
                db.execute(text("DELETE FROM gate_session_bindings"))
            assert db.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 1
            if case.startswith("unknown_"):
                assert db.execute(
                    text(
                        "SELECT settlement_status,operation_result FROM gate_physical_operations WHERE id=3"
                    )
                ).one() == ("UNKNOWN", "NONE")


@pytest.mark.parametrize("fault", ["uuid", "generation", "claim", "scope", "nonzero", "kind"])
def test_empty_observation_cannot_forge_identity_or_result(binding_design, fault):
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db)
        insert_operation(db, id=2, kind="VERIFY" if fault == "kind" else "DISCOVER")
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        changes = {
            "uuid": {"u": uuid4()},
            "generation": {"g": 2},
            "claim": {"e": 2, "t": uuid4()},
            "scope": {"scope": "UNSCOPED"},
            "nonzero": {"mpus": 1},
            "kind": {},
        }
        with pytest.raises(IntegrityError), db.begin_nested():
            record_empty_observation(db, **changes[fault])
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_root(db, token)
        assert db.scalar(text("SELECT count(*) FROM gate_empty_set_observations")) == 0
        assert db.scalar(text("SELECT count(*) FROM gate_physical_resources")) == 0


def test_other_session_or_unknown_observation_cannot_close_empty_set(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db)
        add_binding(db, session_id=2, user_id=2, command_id=2)
        insert_operation(db, id=3, session_id=2)
        insert_operation(db, id=4, session_id=2, kind="DISCOVER")
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        observation = settle_empty_discovery(db, operation_id=4, session_id=2)
        for wrong in (observation, uuid4()):
            with pytest.raises(IntegrityError, match="pointer identity"), db.begin_nested():
                attach_empty_observation(db, wrong)
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_root(db, token)


def test_empty_evidence_is_immutable_and_cannot_replace_resource_ack(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db)
        resource = register_resource(
            db
        )  # An explicitly registered real cleanup target in the SQL experiment.
        insert_operation(db, id=2, kind="DISCOVER")
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        observation = settle_empty_discovery(db)
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_root(db, token)
        for statement in (
            "UPDATE gate_empty_set_observations SET observation_uuid=gen_random_uuid()",
            "DELETE FROM gate_empty_set_observations",
        ):
            with pytest.raises(IntegrityError, match="immutable"), db.begin_nested():
                db.execute(text(statement))
        with pytest.raises(IntegrityError, match="pointer is immutable"), db.begin_nested():
            attach_empty_observation(db, uuid4())
        acknowledge_resource(db, resource, token)
        assert publish_root(db, token) == 1
        assert (
            db.scalar(text("SELECT empty_set_observation_uuid FROM gate_sessions")) == observation
        )


def test_not_found_requires_trusted_observation_not_worker_assertion(binding_design, ledger_roles):
    from sqlalchemy.exc import ProgrammingError

    coordinator, worker = ledger_roles
    with binding_design.begin() as db:
        add_binding(db)
        insert_operation(db)
        token = insert_operation(db, id=2, kind="DISCOVER")
        operation = db.scalar(
            text("SELECT operation_uuid FROM gate_physical_operations WHERE id=2")
        )
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        db.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
        assert assign_worker(db, operation, 1, token, worker)
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{worker}"'))
        with pytest.raises(IntegrityError, match="empty discovery"), db.begin_nested():
            worker_publish(db, operation, 1, token, result="NOT_FOUND")
        with pytest.raises(ProgrammingError), db.begin_nested():
            db.execute(
                text(
                    """INSERT INTO gate_empty_set_observations VALUES(:o,:d,:u,1,1,:t,'NOT_FOUND','EXACT_SESSION_GENERATION',0,0)"""
                ),
                {"o": uuid4(), "d": operation, "u": uuid4(), "t": token},
            )
    with binding_design.begin() as db:
        observation = record_empty_observation(db)
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{worker}"'))
        assert worker_publish(db, operation, 1, token, result="NOT_FOUND")
    with binding_design.begin() as db:
        attach_empty_observation(db, observation)
        assert db.scalar(
            text(
                "SELECT gate_cleanup_ready(operation_uuid) FROM gate_physical_operations WHERE id=1"
            )
        )


def test_old_discovery_claim_observation_cannot_authorize_new_claim(binding_design):
    with binding_design.begin() as db:
        add_binding(db)
        token = insert_operation(db)
        original = insert_operation(db, id=2, kind="DISCOVER")
        db.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))
        old_observation = record_empty_observation(db)
        assert claim_operation(db, original, uuid4(), id=2)
        with pytest.raises(IntegrityError, match="empty discovery"), db.begin_nested():
            publish_success(db, id=2, result="NOT_FOUND")
        with pytest.raises(IntegrityError, match="pointer identity"), db.begin_nested():
            attach_empty_observation(db, old_observation)
        with pytest.raises(IntegrityError, match="all registered locators"), db.begin_nested():
            publish_root(db, token)
        new_observation = settle_empty_discovery(db)
        assert new_observation != old_observation
        assert publish_root(db, token) == 1


@pytest.fixture(params=["null", "missing", "uuid", "generation"])
def orphaned_operation(binding_design, ledger_roles, request):
    coordinator, worker = ledger_roles
    with binding_design.begin() as db:
        token, _, _ = prepare_locators(db)
        operation = db.scalar(text("SELECT operation_uuid FROM gate_physical_operations"))
        resource = (
            db.execute(text("SELECT * FROM gate_physical_resources WHERE resource_kind='MPU'"))
            .mappings()
            .one()
        )
        db.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
        assert assign_worker(db, operation, 1, token, worker)
    # Privileged corruption fixture only; no product trigger is relaxed or replaced.
    with binding_design.begin() as db:
        db.execute(text("SET LOCAL session_replication_role=replica"))
        fault = request.param
        if fault == "null":
            db.execute(text("UPDATE gate_physical_operations SET session_id=NULL"))
        elif fault == "missing":
            db.execute(text("DELETE FROM gate_sessions"))
        elif fault == "uuid":
            db.execute(
                text("UPDATE gate_physical_operations SET session_uuid_snapshot=gen_random_uuid()")
            )
        else:
            db.execute(
                text("UPDATE gate_physical_operations SET session_generation=session_generation+1")
            )
        db.execute(text("SET LOCAL session_replication_role=origin"))
    return operation, token, resource


def test_historical_operation_without_exact_parent_cannot_progress(
    binding_design, ledger_roles, orphaned_operation
):
    coordinator, worker = ledger_roles
    operation, token, resource = orphaned_operation
    with binding_design.connect() as db:
        snapshot = db.execute(text("SELECT * FROM gate_physical_operations")).one()
        counts = [
            db.scalar(text("SELECT count(*) FROM " + name))
            for name in (
                "gate_operation_claims",
                "gate_worker_claim_grants",
                "gate_resource_settlements",
            )
        ]
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
        assert claim_operation(db, token, uuid4()) is False
        assert assign_worker(db, operation, 1, token, worker) is False
    with binding_design.begin() as db:
        db.execute(text(f'SET LOCAL ROLE "{worker}"'))
        assert worker_publish(db, operation, 1, token) is False
        assert worker_ack(db, resource, 1, token) is False
    with binding_design.connect() as db:
        assert db.execute(text("SELECT * FROM gate_physical_operations")).one() == snapshot
        assert [
            db.scalar(text("SELECT count(*) FROM " + name))
            for name in (
                "gate_operation_claims",
                "gate_worker_claim_grants",
                "gate_resource_settlements",
            )
        ] == counts


def test_closure_empty_set_assignment_publication_and_unlink_are_atomic(
    binding_design, ledger_roles
):
    coordinator, worker = ledger_roles
    engine, ready = binding_design, Queue()
    with engine.begin() as db:
        add_binding(db)
        token = insert_operation(db)
        insert_operation(db, id=2, kind="DISCOVER")
        operation = db.scalar(
            text("SELECT operation_uuid FROM gate_physical_operations WHERE id=1")
        )
    with Session(engine) as closing, ThreadPoolExecutor(1) as pool:
        owner = closing.scalar(text("SELECT pg_backend_pid()"))
        closing.execute(text("UPDATE gate_sessions SET terminal=true,resources_closed=true"))

        def late_registration():
            with Session(engine) as late:
                ready.put(late.scalar(text("SELECT pg_backend_pid()")))
                with (
                    pytest.raises(IntegrityError, match="registration identity or fence"),
                    late.begin_nested(),
                ):
                    register_resource(late, kind="MPU", upload_id="late-in-empty-set")
                late.commit()

        contender = pool.submit(late_registration)
        try:
            wait_for_blocker(engine, owner, ready.get(timeout=10))
            observation = settle_empty_discovery(closing)
            assert closing.scalar(text("SELECT count(*) FROM gate_physical_resources")) == 0
            assert closing.scalar(text("SELECT gate_cleanup_ready(:o)"), {"o": operation})
            closing.execute(text(f'SET LOCAL ROLE "{coordinator}"'))
            assert assign_worker(closing, operation, 1, token, worker)
            assert assign_worker(closing, operation, 1, token, worker)
            closing.execute(text(f'SET LOCAL ROLE "{worker}"'))
            assert worker_publish(closing, operation, 1, token)
            closing.execute(text("RESET ROLE"))
            with pytest.raises(RuntimeError), closing.begin_nested():
                closing.execute(text("DELETE FROM gate_session_bindings"))
                closing.execute(text("DELETE FROM gate_sessions"))
                raise RuntimeError("injected before unlink commit")
            assert closing.scalar(text("SELECT count(*) FROM gate_sessions")) == 1
            assert closing.scalar(text("SELECT count(*) FROM gate_session_bindings")) == 1
            closing.execute(text("DELETE FROM gate_session_bindings"))
            closing.execute(text("DELETE FROM gate_sessions"))
        finally:
            closing.commit()
        contender.result(timeout=10)
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM gate_sessions")) == 0
        assert db.scalar(text("SELECT count(*) FROM gate_physical_resources")) == 0
        assert db.scalar(text("SELECT count(*) FROM gate_worker_claim_grants")) == 1
        assert (
            db.scalar(text("SELECT observation_uuid FROM gate_empty_set_observations"))
            == observation
        )
        assert (
            db.scalar(
                text("SELECT count(*) FROM gate_physical_operations WHERE session_id IS NOT NULL")
            )
            == 0
        )
        assert (
            db.scalar(text("SELECT settlement_status FROM gate_physical_operations WHERE id=1"))
            == "SETTLED"
        )
