"""Import terminal state, notification history and wake-ups share one commit."""

from app.composition import storage_resources as _resource_wiring

from app.modules.import_jobs.domain import ImportArtifactKind

from app.modules.import_jobs.requested_options import encode_requested_options

from app.modules.durable_work.failure import DurableFailure
from app.shared.durable_failure import DurableFailureClass


from datetime import timedelta
import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from app.db.models import (
    User,
    ImportJob,
    ImportDispatch,
    ImportArtifact,
    StoredObject,
    ScoreRevisionRenderOutbox,
    Notification,
    RealtimeChange,
)
from app.modules.import_jobs.domain import ImportJobState
from app.modules.import_jobs import notifications, dispatch_service
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
from app.modules.realtime import publisher
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database
from tests.support.import_execution import processing_lease


@pytest.fixture
def outcome(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(User(id=1, email="import@example.test", password_hash="hash"))
            db.flush()
            job = ImportJob(
                processing_started_at=utc_now(),
                job_uuid="job",
                user_id=1,
                state=ImportJobState.PROCESSING,
                requested_options=encode_requested_options({"display_title": "Etudes"}),
            )
            db.add(job)
            db.flush()
            source = StoredObject(
                object_key="review/source.xml",
                byte_size=10,
                sha256="a" * 64,
                content_type="application/xml",
            )
            db.add(source)
            db.flush()
            db.add(
                ImportArtifact(
                    job_id=job.id,
                    artifact_uuid="source",
                    kind=ImportArtifactKind.REVIEW_MUSICXML,
                    stored_object_id=source.id,
                    filename="source.xml",
                )
            )
            db.commit()
            lease = processing_lease(db, job)
        yield engine, lease


def finish(db, lease, result):
    service = ImportExecutionRecorder(usage=_resource_wiring.storage_usage_service)
    if result == "success":
        service.finalize_success(db, lease)
    elif result == "failure":
        service.finalize_failure(
            db,
            lease,
            failure=DurableFailure(
                "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
            ),
        )
    else:
        dispatch_service.ImportDispatchService().recover_and_list_due(db)


def exhaust(engine):
    with Session(engine) as db:
        row = db.scalar(sa.select(ImportDispatch))
        row.attempt_count = dispatch_service.settings.IMPORT_DISPATCH_MAX_ATTEMPTS
        row.started_at = utc_now() - timedelta(days=1)
        db.commit()


@pytest.mark.parametrize("result", ["success", "failure", "exhaustion"])
def test_import_processing_consequences_commit_once(outcome, result):
    engine, lease = outcome
    if result == "exhaustion":
        exhaust(engine)
    with Session(engine) as db:
        finish(db, lease, result)
        job = db.scalar(sa.select(ImportJob))
        notice = db.scalar(sa.select(Notification))
        assert job.state == (
            ImportJobState.READY_FOR_REVIEW if result == "success" else ImportJobState.FAILED
        )
        assert notice.kind == (
            "import.ready_for_review" if result == "success" else "import.failed"
        )
        assert notice.recipient_user_id == 1 and notice.actor_user_id is None
        assert notice.created_at == job.processing_finished_at
        assert notice.import_job_id == "job" and notice.import_display_title_snapshot == "Etudes"
        assert sorted(db.scalars(sa.select(RealtimeChange.kind))) == [
            "import_jobs.changed" if result == "success" else "import_jobs.changed",
            "notifications.changed",
        ]
        assert db.scalar(sa.select(sa.func.count()).select_from(ScoreRevisionRenderOutbox)) == 0
        finish(db, lease, result)
        assert db.scalar(sa.select(sa.func.count()).select_from(Notification)) == 1
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 2


@pytest.mark.parametrize("result", ["success", "failure", "exhaustion"])
@pytest.mark.parametrize("boundary", ["notification", "realtime", "notify", "commit"])
def test_import_processing_consequences_roll_back_together(outcome, monkeypatch, result, boundary):
    engine, lease = outcome
    if result == "exhaustion":
        exhaust(engine)
    with Session(engine) as db:
        job_before = dict(db.execute(sa.select(ImportJob.__table__)).mappings().one())
        delivery_before = dict(db.execute(sa.select(ImportDispatch.__table__)).mappings().one())
        db.rollback()
        if boundary == "commit":
            target, name = db, "commit"
            original = db.flush
        else:
            target, name = {
                "notification": (
                    notifications.notification_service,
                    "admit_import_ready_for_review"
                    if result == "success"
                    else "admit_import_failed",
                ),
                "realtime": (notifications, "publish_change"),
                "notify": (publisher, "_notify_change"),
            }[boundary]
            original = getattr(target, name)

        def fail(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError("terminal admission interrupted")

        monkeypatch.setattr(target, name, fail)
        with pytest.raises(RuntimeError, match="terminal admission interrupted"):
            finish(db, lease, result)
        db.rollback()
        assert dict(db.execute(sa.select(ImportJob.__table__)).mappings().one()) == job_before
        assert (
            dict(db.execute(sa.select(ImportDispatch.__table__)).mappings().one())
            == delivery_before
        )
        for model in (Notification, RealtimeChange, ScoreRevisionRenderOutbox):
            assert db.scalar(sa.select(model)) is None
