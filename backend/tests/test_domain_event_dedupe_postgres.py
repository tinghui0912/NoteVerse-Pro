"""Conflicting journal keys fail closed under real PostgreSQL transactions."""

from queue import Queue
from threading import Thread
from unittest.mock import Mock

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.models import (
    DomainEvent,
    ImportJob,
    ImportJobState,
    NotificationEvent,
    RealtimeEvent,
    RenderOutbox,
)
from app.modules.domain_events.journal import DomainEventDedupeConflict, append_fact
from app.modules.import_jobs.events import ImportJobCompleted, ImportJobFailed
from app.shared.error_codes import ErrorCode
from app.utils.timezone import utc_now_naive
from tests.test_domain_event_dedupe import CONFLICTS, CONFLICT_NAMES
from tests.test_domain_projections_postgres import (
    assert_blocked,
    count,
    database as database,
    finalize,
    seed_job,
)


@pytest.mark.parametrize("persisted,incoming", CONFLICTS, ids=CONFLICT_NAMES)
def test_postgres_dedupe_resolves_only_the_same_complete_immutable_fact(
    database, persisted, incoming
):
    with Session(database) as db:
        first_id = append_fact(db, persisted, occurred_at=utc_now_naive()).id
        db.commit()
        with pytest.raises(DomainEventDedupeConflict):
            append_fact(db, incoming, occurred_at=utc_now_naive())
        db.rollback()
        assert count(db, DomainEvent) == 1
        assert db.get(DomainEvent, first_id).payload == persisted.model_dump(mode="json")


@pytest.mark.parametrize("outcome", ["completed", "failed"])
def test_conflicting_import_fact_rolls_back_state_diagnostics_and_thumbnail_admission(
    database, monkeypatch, outcome
):
    lease = seed_job(database)
    preexisting = (
        ImportJobCompleted(job_id="import-job", recipient_user_id=2, requested_title="Sonatas")
        if outcome == "completed"
        else ImportJobFailed(
            job_id="import-job", recipient_user_id=1, public_failure_code=ErrorCode.TASK_ERROR
        )
    )
    with Session(database) as setup:
        original = append_fact(setup, preexisting, occurred_at=utc_now_naive())
        original_id, original_uuid = original.id, original.event_uuid
        setup.commit()
        before = setup.scalar(select(ImportJob))
        before_state = (
            before.state,
            before.progress,
            before.updated_at,
            before.finished_at,
            before.error,
            before.internal_error_code,
        )
    fast_path = Mock()
    monkeypatch.setattr(
        "app.modules.import_jobs.worker_service.catch_up_import_projections_best_effort", fast_path
    )
    with pytest.raises(DomainEventDedupeConflict):
        with Session(database) as db:
            finalize(db, lease, outcome)
    fast_path.assert_not_called()
    with Session(database) as check:
        job = check.scalar(select(ImportJob))
        assert (
            job.state,
            job.progress,
            job.updated_at,
            job.finished_at,
            job.error,
            job.internal_error_code,
        ) == before_state
        assert job.state == ImportJobState.RUNNING
        assert count(check, RenderOutbox) == 0
        assert count(check, NotificationEvent) == count(check, RealtimeEvent) == 0
        assert count(check, DomainEvent) == 1
        original = check.get(DomainEvent, original_id)
        assert original.event_uuid == original_uuid
        assert original.payload == preexisting.model_dump(mode="json")


def test_concurrent_conflicting_appenders_preserve_the_committed_winner(database):
    fact = ImportJobCompleted(job_id="job", recipient_user_id=1, requested_title="Etudes")
    ready, result = Queue(), Queue()
    with Session(database) as first:
        row = append_fact(first, fact, occurred_at=utc_now_naive())
        identity = (row.id, row.event_uuid)
        winner = first.scalar(text("SELECT pg_backend_pid()"))

        def conflicting_appender():
            try:
                with Session(database) as second, second.begin():
                    ready.put(second.scalar(text("SELECT pg_backend_pid()")))
                    append_fact(
                        second,
                        fact.model_copy(update={"requested_title": "Sonatas"}),
                        occurred_at=utc_now_naive(),
                    )
                result.put(None)
            except BaseException as error:
                result.put(error)

        thread = Thread(target=conflicting_appender)
        thread.start()
        try:
            waiting = ready.get(timeout=10)
            assert_blocked(database, waiting, winner, "pg_advisory_xact_lock")
            first.commit()
        finally:
            first.rollback()
            thread.join(timeout=10)
        assert not thread.is_alive()
        assert isinstance(result.get(timeout=1), DomainEventDedupeConflict)
    with Session(database) as check:
        persisted = check.scalar(select(DomainEvent))
        assert count(check, DomainEvent) == 1
        assert (persisted.id, persisted.event_uuid) == identity
        assert persisted.payload == fact.model_dump(mode="json")
