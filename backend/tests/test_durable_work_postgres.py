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
    set_failure_metadata,
    clear_failure_metadata,
)
from app.modules.ops.query_service import OpsAsyncOperationQueryService
from app.modules.ops.schemas import AsyncOperationKind
from tests.support.postgres_schema import postgres_schema_database


def test_persisted_failure_facts_are_complete_and_shared_by_ops_queries(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="failure@example.test", password_hash="hash"))
            db.flush()
            job = ImportJob(job_uuid="job", user_id=1, state=ImportJobState.PENDING)
            score = Score(score_uuid="score", owner_user_id=1, title="Score")
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
                    {"internal_error_code": "failure"},
                    {
                        "internal_error_code": "failure",
                        "internal_error_stage": "execution",
                        "internal_error_class": "transient",
                    },
                    {
                        "internal_error_code": "failure",
                        "internal_error_stage": "execution",
                        "internal_error_class": "invalid",
                        "internal_error_retryable": False,
                    },
                ]:
                    with pytest.raises(sa.exc.IntegrityError):
                        with db.begin_nested():
                            db.execute(
                                sa.update(type(row)).where(type(row).id == row.id).values(**values)
                            )
                set_failure_metadata(
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
            job.state = ImportJobState.FAILURE
            set_failure_metadata(
                job,
                DurableFailure(
                    "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
                ),
            )
            job.internal_error_detail = "private bounded execution evidence"
            db.commit()
            operation = query.get_operation(
                db, kind=AsyncOperationKind.IMPORT, operation_id=dispatch.dispatch_uuid
            )
            assert operation.status.value == "failed"
            assert operation.failure.code == "import_pipeline_failed"
            assert operation.failure.detail == job.internal_error_detail
            assert operation.failure.retryable is False
            for row in rows:
                clear_failure_metadata(row)
            db.commit()
            assert query.summary(db, failure_class=DurableFailureClass.SYSTEM_ERROR).total == 0
