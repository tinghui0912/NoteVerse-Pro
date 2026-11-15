"""Committed facts, checkpoint atomicity and contention on real PostgreSQL."""

from contextlib import contextmanager
from dataclasses import replace
from queue import Queue
from threading import Event, Thread
from time import monotonic

import pytest
from alembic import command
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db.models import (
    DomainEvent,
    DomainProjectionCheckpoint,
    ImportArtifact,
    ImportJob,
    ImportJobState,
    NotificationEvent,
    RealtimeEvent,
    RenderOutbox,
    StoredObject,
    User,
)
from app.modules.domain_events.journal import append_fact
from app.modules.domain_events.projections import run_projection_batch, run_projections
from app.modules.import_jobs.events import ImportJobCompleted
from app.modules.import_jobs.projections import IMPORT_PROJECTIONS
from app.modules.import_jobs.worker_service import ImportJobExecutionService
from app.shared.error_codes import ErrorCode
from app.utils.timezone import utc_now_naive
from tests.support.import_execution import processing_lease
from tests.support.postgres_schema import postgres_schema_database


@pytest.fixture
def database(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="owner@example.test", password_hash="hash"))
            db.commit()
        yield engine


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def seed_job(engine):
    with Session(engine) as db:
        job = ImportJob(
            job_uuid="import-job",
            user_id=1,
            state=ImportJobState.RUNNING,
            requested_options={"title": "Etudes"},
        )
        db.add(job)
        db.flush()
        db.add(
            ImportArtifact(
                job_id=job.id,
                kind="review_musicxml",
                filename="review.xml",
                stored_object=StoredObject(
                    object_key="review/source",
                    sha256="a" * 64,
                    byte_size=10,
                    content_type="application/xml",
                ),
            )
        )
        db.commit()
        return processing_lease(db, job)


def finalize(db, lease, outcome):
    service = ImportJobExecutionService()
    if outcome == "completed":
        service.finalize_success(db, lease)
    else:
        service.finalize_failure(
            db, lease, "SECRET worker traceback", "InternalCrash", code=ErrorCode.TASK_TIMEOUT
        )


@pytest.mark.parametrize("outcome", ["completed", "failed"])
@pytest.mark.parametrize("commit_succeeds", [False, True])
def test_import_state_thumbnail_and_typed_fact_share_one_commit(
    database, monkeypatch, outcome, commit_succeeds
):
    monkeypatch.setattr(
        "app.modules.import_jobs.worker_service.catch_up_import_projections_best_effort",
        lambda db: None,
    )
    lease = seed_job(database)

    class FailingCommit(Session):
        def commit(self):
            self.flush()
            raise RuntimeError("admission commit failed")

    with (Session if commit_succeeds else FailingCommit)(database) as db:
        if commit_succeeds:
            finalize(db, lease, outcome)
            finalize(db, lease, outcome)  # Task redelivery preserves semantic fact identity.
        else:
            with pytest.raises(RuntimeError, match="admission commit failed"):
                finalize(db, lease, outcome)
            db.rollback()
    with Session(database) as check:
        job = check.scalar(select(ImportJob))
        if not commit_succeeds:
            assert job.state == ImportJobState.RUNNING
            assert count(check, DomainEvent) == count(check, RenderOutbox) == 0
        else:
            assert job.state == (
                ImportJobState.PENDING_REVIEW if outcome == "completed" else ImportJobState.FAILURE
            )
            fact = check.scalar(select(DomainEvent))
            assert count(check, DomainEvent) == 1
            assert fact.event_type == f"import.job.{outcome}"
            assert fact.schema_version == 1 and fact.aggregate_type == "import_job"
            assert (
                fact.aggregate_id == "import-job"
                and fact.dedupe_key == f"import.job.{outcome}:import-job"
            )
            assert fact.payload == (
                {"job_id": "import-job", "recipient_user_id": 1, "requested_title": "Etudes"}
                if outcome == "completed"
                else {
                    "job_id": "import-job",
                    "recipient_user_id": 1,
                    "public_failure_code": ErrorCode.TASK_TIMEOUT,
                }
            )
            assert count(check, RenderOutbox) == (1 if outcome == "completed" else 0)
        assert count(check, NotificationEvent) == count(check, RealtimeEvent) == 0


def append_samples(engine, size=2):
    with Session(engine) as db:
        rows = [
            append_fact(
                db,
                ImportJobCompleted(
                    job_id=f"job-{i}", recipient_user_id=1, requested_title="Etudes"
                ),
                occurred_at=utc_now_naive(),
            )
            for i in range(size)
        ]
        ids = [row.id for row in rows]
        db.commit()
        return ids


def checkpoint(db, name):
    row = db.get(DomainProjectionCheckpoint, name)
    return row.last_event_id if row else 0


def test_failed_batch_rolls_back_notification_wakeups_and_checkpoint_then_retries_once(database):
    ids = append_samples(database)
    original = IMPORT_PROJECTIONS[0]

    def fail_after_writes(db, event, fact):
        original.handle(db, event, fact)
        if event.id == ids[1]:
            raise RuntimeError("projection interrupted")

    with Session(database) as db:
        with pytest.raises(RuntimeError, match="projection interrupted"):
            run_projection_batch(db, replace(original, handle=fail_after_writes))
        assert count(db, NotificationEvent) == count(db, RealtimeEvent) == 0
        assert checkpoint(db, original.name) == 0
        db.rollback()
        assert run_projection_batch(db, original) == 2
        assert run_projection_batch(db, original) == 0
        assert count(db, NotificationEvent) == count(db, RealtimeEvent) == 2
        assert checkpoint(db, original.name) == ids[-1]
        assert set(db.scalars(select(RealtimeEvent.type))) == {"notification.created"}


@pytest.mark.parametrize("failed_index", [0, 1])
def test_projectors_progress_and_recover_independently(database, failed_index):
    ids = append_samples(database)

    def fail(db, event, fact):
        raise RuntimeError("one projection unavailable")

    definitions = list(IMPORT_PROJECTIONS)
    definitions[failed_index] = replace(definitions[failed_index], handle=fail)
    with Session(database) as db:
        with pytest.raises(ExceptionGroup):
            run_projections(db, definitions)
        assert checkpoint(db, definitions[failed_index].name) == 0
        assert checkpoint(db, definitions[1 - failed_index].name) == ids[-1]
        db.rollback()
        assert run_projections(db, IMPORT_PROJECTIONS) == 2
        assert count(db, NotificationEvent) == 2
        assert count(db, RealtimeEvent) == 4
        assert {checkpoint(db, definition.name) for definition in definitions} == {ids[-1]}


@pytest.mark.parametrize("invalid", ["version", "payload", "aggregate"])
def test_owned_poisoned_event_blocks_progress_without_projection_writes(database, invalid):
    fact = ImportJobCompleted(job_id="job", recipient_user_id=1)
    with Session(database) as db:
        db.add(
            DomainEvent(
                event_type=fact.event_type,
                schema_version=999 if invalid == "version" else 1,
                aggregate_type=fact.aggregate_type,
                aggregate_id="other" if invalid == "aggregate" else "job",
                dedupe_key=fact.dedupe_key,
                payload={"bad": "payload"}
                if invalid == "payload"
                else fact.model_dump(mode="json"),
                occurred_at=utc_now_naive(),
            )
        )
        db.commit()
        with pytest.raises(ValueError):
            run_projection_batch(db, IMPORT_PROJECTIONS[0])
        assert checkpoint(db, IMPORT_PROJECTIONS[0].name) == 0
        assert count(db, NotificationEvent) == count(db, RealtimeEvent) == 0


def test_bounded_batches_advance_in_journal_order(database):
    ids = append_samples(database, 5)
    with Session(database) as db:
        definition = IMPORT_PROJECTIONS[1]
        assert run_projection_batch(db, definition, batch_size=2) == 2
        assert checkpoint(db, definition.name) == ids[1]
        db.rollback()
        assert run_projection_batch(db, definition, batch_size=2) == 2
        assert checkpoint(db, definition.name) == ids[3]
        db.rollback()
        assert run_projection_batch(db, definition, batch_size=2) == 1
        assert run_projection_batch(db, definition, batch_size=2) == 0
        assert count(db, RealtimeEvent) == 5


def assert_blocked(engine, waiting, winner, expected_query):
    deadline = monotonic() + 10
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        while not observer.scalar(
            text("SELECT :winner = ANY(pg_blocking_pids(:waiting))"),
            {"winner": winner, "waiting": waiting},
        ):
            assert monotonic() < deadline, "Second transaction must actually block in PostgreSQL"
        query = observer.execute(
            text("SELECT wait_event_type, query FROM pg_stat_activity WHERE pid=:pid"),
            {"pid": waiting},
        ).one()
        assert query.wait_event_type == "Lock" and expected_query in query.query.lower()


@pytest.mark.parametrize("existing_checkpoint", [False, True])
def test_concurrent_projectors_lock_the_same_checkpoint_and_refresh_progress(
    database, existing_checkpoint
):
    ids = append_samples(database, 1)
    definition = IMPORT_PROJECTIONS[0]
    if existing_checkpoint:
        with Session(database) as db:
            db.add(DomainProjectionCheckpoint(projection_name=definition.name))
            db.commit()
    ready, outcomes = Queue(), Queue()
    release = Event()

    class HeldCommit(Session):
        def commit(self):
            self.flush()
            ready.put(self.scalar(text("SELECT pg_backend_pid()")))
            assert release.wait(15)
            super().commit()

    def first():
        try:
            with HeldCommit(database) as db:
                outcomes.put(run_projection_batch(db, definition))
        except BaseException as error:
            outcomes.put(error)

    def second():
        try:
            with Session(database) as db:
                # Keep an identity-map checkpoint alive at its earlier progress.
                cached = db.get(DomainProjectionCheckpoint, definition.name)
                if cached is not None:
                    assert cached.last_event_id == 0
                ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                outcomes.put(run_projection_batch(db, definition))
        except BaseException as error:
            outcomes.put(error)

    t1, t2 = Thread(target=first), Thread(target=second)
    t1.start()
    winner = ready.get(timeout=10)
    t2.start()
    try:
        waiting = ready.get(timeout=10)
        assert_blocked(database, waiting, winner, "domain_projection_checkpoints")
    finally:
        release.set()
        t1.join(timeout=10)
        t2.join(timeout=10)
    assert not t1.is_alive() and not t2.is_alive()
    results = [outcomes.get(timeout=1), outcomes.get(timeout=1)]
    assert all(isinstance(result, int) for result in results), results
    assert sorted(results) == [0, 1]
    with Session(database) as db:
        assert checkpoint(db, definition.name) == ids[0]
        assert count(db, NotificationEvent) == count(db, RealtimeEvent) == 1


@pytest.mark.parametrize("duplicate", [False, True])
def test_append_gate_preserves_commit_order_and_concurrent_semantic_dedupe(database, duplicate):
    ready, outcome = Queue(), Queue()
    fact = ImportJobCompleted(job_id="first", recipient_user_id=1)
    with Session(database) as first:
        first_id = append_fact(first, fact, occurred_at=utc_now_naive()).id
        winner = first.scalar(text("SELECT pg_backend_pid()"))

        def append_second():
            try:
                with Session(database) as db:
                    ready.put(db.scalar(text("SELECT pg_backend_pid()")))
                    second = append_fact(
                        db,
                        fact
                        if duplicate
                        else ImportJobCompleted(job_id="second", recipient_user_id=1),
                        occurred_at=utc_now_naive(),
                    )
                    second_id = second.id
                    db.commit()
                    outcome.put(second_id)
            except BaseException as error:
                outcome.put(error)

        thread = Thread(target=append_second)
        thread.start()
        try:
            waiting = ready.get(timeout=10)
            assert_blocked(database, waiting, winner, "pg_advisory_xact_lock")
            with Session(database) as projector:
                assert run_projection_batch(projector, IMPORT_PROJECTIONS[1]) == 0
            first.commit()
        finally:
            first.rollback()
            thread.join(timeout=10)
        assert not thread.is_alive()
        second_id = outcome.get(timeout=1)
        assert isinstance(second_id, int), second_id
        assert second_id == first_id if duplicate else second_id > first_id
    with Session(database) as db:
        assert count(db, DomainEvent) == (1 if duplicate else 2)
        assert run_projection_batch(db, IMPORT_PROJECTIONS[1]) == (1 if duplicate else 2)


@pytest.mark.parametrize("outcome", ["completed", "failed"])
def test_committed_import_survives_fast_path_failure_and_maintenance_repairs_projections(
    database, monkeypatch, outcome
):
    from app.modules.import_jobs import projections
    from app.worker.execution import domain_projections as maintenance

    lease = seed_job(database)
    real_runner = projections.run_projections
    monkeypatch.setattr(
        projections,
        "run_projections",
        lambda *args: (_ for _ in ()).throw(RuntimeError("projector unavailable")),
    )
    with Session(database) as db:
        finalize(db, lease, outcome)
    with Session(database) as db:
        assert count(db, DomainEvent) == 1
        assert count(db, NotificationEvent) == count(db, RealtimeEvent) == 0
        assert db.scalar(select(ImportJob.state)) == (
            ImportJobState.PENDING_REVIEW if outcome == "completed" else ImportJobState.FAILURE
        )
    monkeypatch.setattr(projections, "run_projections", real_runner)

    @contextmanager
    def worker_database():
        with Session(database) as db:
            yield db
            db.commit()

    monkeypatch.setattr(maintenance, "SessionLocal", worker_database)
    monkeypatch.setattr(maintenance, "run_scheduler_scan", lambda key, callback: callback())
    assert maintenance.execute_domain_projection_maintenance() == {"processed": 2}
    assert maintenance.execute_domain_projection_maintenance() == {"processed": 0}
    with Session(database) as db:
        notification = db.scalar(select(NotificationEvent))
        assert notification.type == f"import.{outcome}"
        assert notification.resource_type == "job" and notification.resource_id == "import-job"
        assert notification.data == (
            {"job_id": "import-job", "job_title": "Etudes"}
            if outcome == "completed"
            else {"job_id": "import-job"}
        )
        assert set(db.scalars(select(RealtimeEvent.type))) == {
            "notification.created",
            f"import_job.{outcome}",
        }
        assert count(db, NotificationEvent) == 1 and count(db, RealtimeEvent) == 2


def test_postgres_enforces_append_only_journal_and_structural_constraints(database):
    ids = append_samples(database, 1)
    for mutation in ["UPDATE domain_events SET payload='{}'::jsonb", "DELETE FROM domain_events"]:
        with database.connect() as connection:
            with pytest.raises(DBAPIError, match="append-only"):
                connection.execute(text(mutation))
            connection.rollback()
    with Session(database) as db:
        event = db.get(DomainEvent, ids[0])
        event.aggregate_id = "changed"
        with pytest.raises(ValueError, match="append-only"):
            db.flush()
        db.rollback()
        db.add(DomainProjectionCheckpoint(projection_name="invalid-progress", last_event_id=-1))
        with pytest.raises(DBAPIError):
            db.commit()
        db.rollback()
        db.add(
            DomainEvent(
                event_type="import.job.completed",
                schema_version=0,
                aggregate_type="import_job",
                aggregate_id="invalid",
                dedupe_key="invalid",
                payload={},
                occurred_at=utc_now_naive(),
            )
        )
        with pytest.raises(DBAPIError):
            db.commit()


def test_database_representations_can_be_rebuilt_from_retained_facts(database):
    ids = append_samples(database)
    with Session(database) as db:
        assert run_projections(db, IMPORT_PROJECTIONS) == 4
        db.execute(delete(RealtimeEvent))
        db.execute(delete(NotificationEvent))
        db.execute(delete(DomainProjectionCheckpoint))
        db.commit()
        assert run_projections(db, IMPORT_PROJECTIONS) == 4
        assert list(db.scalars(select(DomainEvent.id).order_by(DomainEvent.id))) == ids
        assert count(db, NotificationEvent) == 2 and count(db, RealtimeEvent) == 4


def test_projection_failure_reports_do_not_expand_invalid_payloads(database):
    from traceback import format_exception

    marker = "private-persisted-payload-value"
    with Session(database) as db:
        db.add(
            DomainEvent(
                event_type="import.job.completed",
                schema_version=1,
                aggregate_type="import_job",
                aggregate_id="job",
                dedupe_key="bad-fact",
                payload={"unexpected": marker},
                occurred_at=utc_now_naive(),
            )
        )
        db.commit()
        with pytest.raises(ExceptionGroup) as error:
            run_projections(db, IMPORT_PROJECTIONS)
        assert marker not in "".join(format_exception(error.value))
        assert {checkpoint(db, definition.name) for definition in IMPORT_PROJECTIONS} == {0}
