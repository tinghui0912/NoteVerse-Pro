"""Persisted failure consistency and the operator SQL projection on PostgreSQL."""

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session

from app.db.models import (
    User,
    Score,
    ScoreRevision,
    RevisionOrigin,
    ImportJob,
    ImportJobState,
    ImportDispatch,
    RenderOutbox,
    RenderTargetType,
    PlaybackOutbox,
    MailOutbox,
    ScoreDeletionOperation,
)
from app.modules.durable_work.failure import (
    DurableFailure,
    DurableFailureClass,
    set_failure_facts,
    clear_failure_facts,
)
from app.shared.time import utc_now
from app.modules.ops.query_service import OpsAsyncOperationQueryService
from app.modules.ops.schemas import AsyncOperationKind
from tests.support.postgres_schema import postgres_schema_database


def test_import_state_requires_complete_failure_facts(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="state@example.test", password_hash="hash"))
            db.commit()
            score = Score(score_uuid="confirmed", display_title="Score", owner_user_id=1)
            db.add(score)
            db.commit()
            score_id = score.id
            for state in ImportJobState:
                for failed in (False, True):
                    job = ImportJob(
                        job_uuid=f"{state.value}-{failed}",
                        user_id=1,
                        state=state,
                        processing_started_at=utc_now()
                        if state
                        in {
                            ImportJobState.PROCESSING,
                            ImportJobState.READY_FOR_REVIEW,
                            ImportJobState.CONFIRMED,
                        }
                        else None,
                        processing_finished_at=utc_now()
                        if state
                        in {
                            ImportJobState.READY_FOR_REVIEW,
                            ImportJobState.CONFIRMED,
                            ImportJobState.FAILED,
                        }
                        else None,
                        confirmed_at=utc_now() if state == ImportJobState.CONFIRMED else None,
                        score_id=score_id if state == ImportJobState.CONFIRMED else None,
                    )
                    if failed:
                        set_failure_facts(
                            job,
                            DurableFailure(
                                "import_pipeline_failed",
                                "pipeline",
                                DurableFailureClass.SYSTEM_ERROR,
                                False,
                            ),
                        )
                    db.add(job)
                    if failed == (state == ImportJobState.FAILED):
                        db.commit()
                        db.expire_all()
                        assert job.state == state and job.failure_detail is None
                        assert (job.failure_code is not None) is failed
                    else:
                        with pytest.raises(sa.exc.IntegrityError):
                            db.commit()
                        db.rollback()


def test_persisted_failure_facts_are_complete_and_shared_by_ops_queries(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="failure@example.test", password_hash="hash"))
            db.flush()
            job = ImportJob(job_uuid="job", user_id=1, state=ImportJobState.QUEUED)
            score = Score(score_uuid="score", owner_user_id=1, display_title="Score")
            db.add_all([job, score])
            db.flush()
            revision = ScoreRevision(
                revision_uuid="revision",
                score_id=score.id,
                revision_number=1,
                content_hash="a" * 64,
                origin=RevisionOrigin.IMPORT,
            )
            db.add(revision)
            db.flush()
            dispatch = ImportDispatch(job_id=job.id)
            render = RenderOutbox(
                outbox_uuid="render",
                target_type=RenderTargetType.SCORE_REVISION,
                score_id=score.id,
                revision_id=revision.id,
                source_fingerprint="a" * 64,
            )
            playback = PlaybackOutbox(
                outbox_uuid="playback",
                score_id=score.id,
                revision_id=revision.id,
                source_fingerprint="a" * 64,
            )
            mail = MailOutbox(
                category="auth",
                dedupe_key="failure",
                recipient="user@example.test",
                subject="Subject",
            )
            deletion = ScoreDeletionOperation(score_uuid="score", owner_user_id=1)
            db.add_all([dispatch, render, playback, mail, deletion])
            db.commit()
            rows = [job, dispatch, render, playback, mail, deletion]
            for row in rows:
                for values in [
                    {"failure_code": "failure"},
                    {
                        "failure_code": "failure",
                        "failure_stage": "execution",
                        "failure_classification": "transient",
                    },
                    {
                        "failure_code": "failure",
                        "failure_stage": "execution",
                        "failure_classification": "invalid",
                        "failure_retryable": False,
                    },
                ]:
                    with pytest.raises(sa.exc.IntegrityError):
                        with db.begin_nested():
                            db.execute(
                                sa.update(type(row)).where(type(row).id == row.id).values(**values)
                            )
                if row is job:
                    continue
                set_failure_facts(
                    row,
                    DurableFailure(
                        "domain_failure", "execution", DurableFailureClass.SYSTEM_ERROR, True
                    ),
                )
            db.commit()
            query = OpsAsyncOperationQueryService()
            page = query.list_operations(
                db, limit=10, failure_class=DurableFailureClass.SYSTEM_ERROR
            )
            summary = query.summary(db, failure_class=DurableFailureClass.SYSTEM_ERROR)
            assert len(page.items) == summary.total == 5
            assert {item.status.value for item in page.items} == {"retrying"}
            assert {item.kind for item in page.items} == set(AsyncOperationKind)
            job.state = ImportJobState.FAILED
            job.processing_finished_at = utc_now()
            set_failure_facts(
                job,
                DurableFailure(
                    "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
                ),
            )
            job.failure_detail = "private bounded execution evidence"
            db.commit()
            operation = query.get_operation(
                db, kind=AsyncOperationKind.IMPORT, operation_id=dispatch.dispatch_uuid
            )
            assert operation.status.value == "failed"
            assert operation.failure.code == "import_pipeline_failed"
            assert operation.failure.detail == job.failure_detail
            assert operation.failure.retryable is False
            for row in rows:
                clear_failure_facts(row)
            job.state = ImportJobState.QUEUED
            job.processing_finished_at = None
            db.commit()
            assert query.summary(db, failure_class=DurableFailureClass.SYSTEM_ERROR).total == 0
