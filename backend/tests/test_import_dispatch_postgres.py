"""Real PostgreSQL ownership constraints and concurrent Import lease authority."""

from datetime import timedelta

import pytest
import sqlalchemy as sa
from alembic import command
from sqlmodel import Session

from app.db.models import (
    ImportDispatch,
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    ImportJobUpload,
    StoredObject,
    Upload,
    User,
)
from app.modules.import_jobs.dispatch_service import (
    ImportDispatchService,
    require_current_attempt,
    StaleImportDispatchAttempt,
)
from app.modules.import_jobs.worker_service import SyncImportJobService
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database


def test_fresh_import_schema_ownership_token_constraints_and_cascade(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        assert {c["name"] for c in inspector.get_columns("import_jobs")} == {
            "id",
            "job_uuid",
            "user_id",
            "state",
            "progress",
            "current_step",
            "idempotency_key",
            "requested_options",
            "execution_manifest_id",
            "internal_error_code",
            "internal_error_stage",
            "internal_error_class",
            "internal_error_retryable",
            "code",
            "error",
            "error_type",
            "requested_at",
            "started_at",
            "last_heartbeat_at",
            "finished_at",
            "score_id",
            "created_at",
            "updated_at",
        }
        assert {c["name"] for c in inspector.get_columns("import_dispatches")} == {
            "id",
            "dispatch_uuid",
            "job_id",
            "originating_request_id",
            "traceparent",
            "tracestate",
            "status",
            "attempt_count",
            "next_attempt_at",
            "dispatched_at",
            "started_at",
            "completed_at",
            "last_error",
            "attempt_token",
            "internal_error_code",
            "internal_error_stage",
            "internal_error_class",
            "internal_error_retryable",
            "created_at",
            "updated_at",
        }
        fks = inspector.get_foreign_keys("import_dispatches")
        assert len(fks) == 1 and fks[0]["constrained_columns"] == ["job_id"]
        assert (
            fks[0]["referred_table"] == "import_jobs" and fks[0]["options"]["ondelete"] == "CASCADE"
        )
        indexes = inspector.get_indexes("import_dispatches")
        assert any(i["column_names"] == ["status", "next_attempt_at"] for i in indexes)
        assert any(i["column_names"] == ["originating_request_id"] for i in indexes)
        with Session(engine) as db:
            db.add(User(id=1, email="import@example.com", password_hash="test"))
            db.flush()
            job = ImportJob(job_uuid="import-pg", user_id=1, state=ImportJobState.PENDING)
            db.add(job)
            db.flush()
            row = ImportDispatch(job_id=job.id)
            db.add(row)
            db.commit()
            job_id, dispatch_uuid = job.id, row.dispatch_uuid
            for values in [
                dict(attempt_count=-1),
                dict(status=ImportDispatchStatus.PROCESSING),
                dict(attempt_token="unclaimed"),
            ]:
                with pytest.raises(sa.exc.IntegrityError):
                    with db.begin_nested():
                        db.execute(
                            sa.update(ImportDispatch)
                            .where(ImportDispatch.id == row.id)
                            .values(**values)
                        )
            for duplicate in [
                ImportDispatch(job_id=job_id),
                ImportDispatch(job_id=999999),
                ImportDispatch(job_id=job_id, dispatch_uuid=dispatch_uuid),
            ]:
                with pytest.raises(sa.exc.IntegrityError):
                    with db.begin_nested():
                        db.add(duplicate)
                        db.flush()
            # Exercise dispatch UUID uniqueness independently of unique job ownership.
            other = ImportJob(job_uuid="other-pg", user_id=1, state=ImportJobState.PENDING)
            db.add(other)
            db.flush()
            with pytest.raises(sa.exc.IntegrityError):
                with db.begin_nested():
                    db.add(ImportDispatch(job_id=other.id, dispatch_uuid=dispatch_uuid))
                    db.flush()
            db.execute(sa.delete(ImportJob).where(ImportJob.id == job_id))
            db.commit()
            assert (
                db.scalar(
                    sa.select(ImportDispatch).where(ImportDispatch.dispatch_uuid == dispatch_uuid)
                )
                is None
            )


def test_mutation_lock_excludes_recovery_and_reclaimed_attempt_fences_cached_worker(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as setup:
            setup.add(User(id=1, email="lease@example.com", password_hash="test"))
            setup.flush()
            job = ImportJob(job_uuid="lease-pg", user_id=1, state=ImportJobState.PENDING)
            physical = StoredObject(
                object_key="input.png", sha256="a" * 64, byte_size=3, content_type="image/png"
            )
            setup.add_all([job, physical])
            setup.flush()
            upload = Upload(
                upload_uuid="input",
                stored_object_id=physical.id,
                uploader_user_id=1,
                original_filename="input.png",
            )
            setup.add(upload)
            setup.flush()
            setup.add(
                ImportJobUpload(job_id=job.id, upload_id=upload.id, sort_order=1, page_number=1)
            )
            row = ImportDispatch(job_id=job.id)
            setup.add(row)
            setup.commit()
            service = ImportDispatchService()
            first = service.claim(setup, row.dispatch_uuid).lease
            setup.commit()
            row.started_at = utc_now_naive() - timedelta(
                seconds=service.lifecycle().policy.processing_timeout_seconds + 1
            )
            setup.add(row)
            setup.commit()
        with Session(engine, expire_on_commit=False) as worker, Session(engine) as recovery:
            current = require_current_attempt(worker, first)
            assert current.job_uuid == "lease-pg"
            assert service.recover_and_list_due(recovery) == []  # Dispatch row is worker-locked.
            current.progress = 37
            worker.commit()
            assert service.recover_and_list_due(recovery) == [first.dispatch_uuid]
            second = service.claim(recovery, first.dispatch_uuid).lease
            recovery.commit()
            assert second.attempt == first.attempt + 1 and second.token != first.token
            # populate_existing defeats an identity-map copy of the first attempt.
            with pytest.raises(StaleImportDispatchAttempt):
                SyncImportJobService().update_progress(worker, first, "RUNNING", 99)
            worker.rollback()
            SyncImportJobService().update_progress(recovery, second, "RUNNING", 21)
            worker.expire_all()
            assert worker.scalar(sa.select(ImportJob)).progress == 21


@pytest.mark.parametrize(
    "locked_state",
    [
        ImportJobState.PENDING_REVIEW,
        ImportJobState.RUNNING,
        ImportJobState.PENDING,
        ImportJobState.CONFIRMED,
    ],
)
def test_deletion_contends_on_dispatch_before_job_and_rechecks_state(monkeypatch, locked_state):
    import asyncio
    from queue import Queue
    from threading import Thread, Event
    from time import monotonic
    from app.core.exceptions import ValidationException
    from app.modules.import_jobs.deletion_service import ImportJobDeletionService
    from app.shared.constants import ErrorCode
    from tests.test_score_revision_services import AsyncSessionAdapter

    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as setup:
            setup.add(User(id=1, email="delete@example.com", password_hash="test"))
            setup.flush()
            job = ImportJob(job_uuid="delete-job", user_id=1, state=ImportJobState.PENDING_REVIEW)
            setup.add(job)
            setup.flush()
            setup.add(ImportDispatch(job_id=job.id))
            setup.commit()
            job_id = job.id
        ready, result, start = Queue(), Queue(), Event()

        def delete_in_session():
            try:
                with Session(engine, expire_on_commit=False) as deleting:
                    stale_job = deleting.get(ImportJob, job_id)
                    pid = deleting.scalar(sa.text("SELECT pg_backend_pid()"))
                    ready.put(pid)
                    assert start.wait(10)
                    asyncio.run(
                        ImportJobDeletionService().delete_job(
                            AsyncSessionAdapter(deleting), stale_job, 1
                        )
                    )
                result.put(None)
            except BaseException as exc:
                result.put(exc)

        with Session(engine) as worker:
            worker.scalar(
                sa.select(ImportDispatch).where(ImportDispatch.job_id == job_id).with_for_update()
            )
            worker_pid = worker.scalar(sa.text("SELECT pg_backend_pid()"))
            thread = Thread(target=delete_in_session)
            thread.start()
            try:
                deleting_pid = ready.get(timeout=10)
                start.set()
                deadline = monotonic() + 10
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    while True:
                        blocked = observer.scalar(
                            sa.text("SELECT :worker = ANY(pg_blocking_pids(:deleting))"),
                            {"worker": worker_pid, "deleting": deleting_pid},
                        )
                        if blocked:
                            break
                        assert monotonic() < deadline, (
                            "Deletion must contend on the held dispatch lock"
                        )
                # If deletion held Job before waiting on Dispatch, NOWAIT would fail.
                current = worker.scalar(
                    sa.select(ImportJob).where(ImportJob.id == job_id).with_for_update(nowait=True)
                )
                if locked_state == ImportJobState.CONFIRMED:
                    from app.db.models import Score, ScoreRevision

                    score = Score(
                        score_uuid="confirmed-under-lock",
                        title="Confirmed",
                        owner_user_id=1,
                        originating_job_id=job_id,
                    )
                    worker.add(score)
                    worker.flush()
                    revision = ScoreRevision(
                        revision_uuid="confirmed-revision",
                        score_id=score.id,
                        revision_number=1,
                        content_hash="a" * 64,
                        origin="OMR",
                        created_by_job_id=job_id,
                    )
                    worker.add(revision)
                    current.score_id = score.id
                current.state = locked_state
                worker.add(current)
                worker.commit()
            finally:
                start.set()
                worker.rollback()
                thread.join(timeout=10)
            assert not thread.is_alive(), "Deletion must finish after Dispatch lock release"
            error = result.get(timeout=1)
            with Session(engine) as check:
                if locked_state != ImportJobState.PENDING_REVIEW:
                    assert isinstance(error, ValidationException)
                    assert error.code == (
                        ErrorCode.JOB_RUNNING
                        if locked_state == ImportJobState.RUNNING
                        else ErrorCode.VALIDATION_ERROR
                    )
                    assert error.details == {"field": "state"}
                    assert check.get(ImportJob, job_id).state == locked_state
                    assert check.scalar(sa.select(ImportDispatch)) is not None
                    if locked_state == ImportJobState.CONFIRMED:
                        from app.db.models import Score, ScoreRevision

                        persisted_score = check.scalar(sa.select(Score))
                        assert (
                            persisted_score is not None
                            and persisted_score.originating_job_id == job_id
                        )
                        assert check.get(ImportJob, job_id).score_id == persisted_score.id
                        assert check.scalar(sa.select(ScoreRevision)).created_by_job_id == job_id
                else:
                    assert error is None
                    assert check.get(ImportJob, job_id) is None
                    assert check.scalar(sa.select(ImportDispatch)) is None
