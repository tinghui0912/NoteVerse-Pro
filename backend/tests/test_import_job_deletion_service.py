"""Import semantic release succeeds independently of another physical owner."""

from app.modules.import_jobs.requested_options import encode_requested_options
from app.db.models.import_job import ImportArtifactKind

from app.shared.time import utc_now

import pytest
from sqlalchemy import select
from app.db.models import (
    ImportJob,
    ImportJobUpload,
    Upload,
    Score,
    ScoreRevision,
    ImportDispatch,
    ImportArtifact,
    StoredObjectRetirement,
    StoredObject,
    User,
    StorageUsageCounter,
    StorageUsageCategory,
)
from app.db.models.import_job import ImportJobState
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.import_jobs.deletion_service import ImportJobDeletionService
from app.modules.durable_work.failure import DurableFailure, set_failure_facts
from app.shared.durable_failure import DurableFailureClass
from app.modules.storage_usage.service import storage_usage_service
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
)
from tests.support.retirement import drain_retirements


@pytest.mark.parametrize("shared", [False, True])
@pytest.mark.parametrize(
    "keep_job,state",
    [
        (False, ImportJobState.READY_FOR_REVIEW),
        (False, ImportJobState.FAILED),
        (True, ImportJobState.CONFIRMED),
    ],
)
def test_import_release_accounts_atomically_and_protects_other_owners(
    score_service_session, shared, keep_job, state
):
    db, storage = score_service_session
    job = ImportJob(
        requested_options=encode_requested_options(None),
        job_uuid="release-job",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW if keep_job else state,
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
    )
    if job.state == ImportJobState.FAILED:
        set_failure_facts(
            job,
            DurableFailure(
                "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
            ),
        )
    db.add(job)
    db.flush()
    db.add(ImportDispatch(job_id=job.id))
    content = b"<score-partwise/>"
    obj = object_from_bytes(
        object_key="jobs/review.musicxml", content=content, content_type="application/xml"
    )
    db.add(obj)
    db.flush()
    identity = obj.id
    storage.put_bytes(key=obj.object_key, content=content, content_type=obj.content_type)
    db.add(
        ImportArtifact(
            job_id=job.id,
            kind=ImportArtifactKind.REVIEW_MUSICXML,
            filename="review.musicxml",
            stored_object_id=identity,
        )
    )
    if shared:
        db.get(User, 1).avatar_object_id = identity
    db.commit()
    job_id = job.id
    if keep_job:
        score = Score(
            score_uuid="confirmed-score",
            display_title="Confirmed",
            owner_user_id=1,
            created_from_import_job_id=job_id,
        )
        db.add(score)
        db.flush()
        revision = ScoreRevision(
            revision_uuid="confirmed-revision",
            score_id=score.id,
            revision_number=1,
            content_hash="a" * 64,
            origin="OMR",
        )
        db.add(revision)
        db.flush()
        from app.modules.import_jobs.lifecycle import mark_confirmed

        mark_confirmed(job, now=utc_now())
        db.commit()
        score_id, revision_id = score.id, revision.id
    storage_usage_service.record_allocation(
        db,
        user_id=1,
        category=StorageUsageCategory.TEMP_IMPORT,
        bytes_count=len(content),
        reason="test",
        object_type="import_artifact",
    )
    db.commit()
    service = ImportJobDeletionService()
    release = service.cleanup_binary_artifacts if keep_job else service.delete_job
    release(db, job, 1)
    assert (db.get(ImportJob, job_id) is not None) is keep_job
    assert db.scalar(select(ImportArtifact)) is None
    if keep_job:
        assert db.get(ImportJob, job_id).state == ImportJobState.CONFIRMED
        assert db.get(Score, score_id).created_from_import_job_id == job_id
        assert db.get(ScoreRevision, revision_id).score_id == score_id
        service.cleanup_binary_artifacts(db, job, 1)
        assert db.get(ImportJob, job_id) is not None
    assert storage.exists(obj.object_key)
    counter = db.scalar(
        select(StorageUsageCounter).where(
            StorageUsageCounter.category == StorageUsageCategory.TEMP_IMPORT
        )
    )
    assert counter.used_bytes == 0
    operation = db.scalar(
        select(StoredObjectRetirement).where(StoredObjectRetirement.stored_object_id == identity)
    )
    assert (operation is None) is shared
    if not shared:
        assert operation.status == "PENDING"
        assert drain_retirements(db, storage)[0]["status"] == "completed"
        assert db.get(StoredObject, identity) is None
        assert not storage.exists("jobs/committed")


@pytest.mark.parametrize(
    "state", [ImportJobState.QUEUED, ImportJobState.PROCESSING, ImportJobState.CONFIRMED]
)
def test_import_release_rechecks_locked_job_state(score_service_session, state):
    from sqlalchemy import update
    from sqlalchemy.orm.attributes import set_committed_value
    from app.core.exceptions import ValidationException
    from app.shared.error_codes import CustomerErrorCode

    db, _ = score_service_session
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_started_at=utc_now(),
        processing_finished_at=utc_now(),
        job_uuid="state-changed-job",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW,
    )
    if job.state == ImportJobState.FAILED:
        set_failure_facts(
            job,
            DurableFailure(
                "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
            ),
        )
    db.add(job)
    db.flush()
    db.add(ImportDispatch(job_id=job.id))
    db.commit()
    # Leave the actual caller identity-map value stale, not just a detached fake.
    values = {"state": state}
    if state == ImportJobState.QUEUED:
        values.update(processing_started_at=None, processing_finished_at=None)
    elif state == ImportJobState.PROCESSING:
        values.update(processing_finished_at=None)
    else:
        score = Score(score_uuid="locked-score", display_title="Score", owner_user_id=1)
        db.add(score)
        db.flush()
        values.update(confirmed_at=utc_now())
    db.execute(
        update(ImportJob)
        .where(ImportJob.id == job.id)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    db.refresh(job)
    set_committed_value(job, "state", ImportJobState.READY_FOR_REVIEW)
    with pytest.raises(ValidationException) as error:
        ImportJobDeletionService().delete_job(db, job, 1)
    assert error.value.code == (
        CustomerErrorCode.JOB_RUNNING
        if state == ImportJobState.PROCESSING
        else CustomerErrorCode.VALIDATION_ERROR
    )
    assert error.value.details == {"field": "state"}
    assert db.get(ImportJob, job.id).state == state
    assert db.scalar(select(ImportDispatch)) is not None


def test_internal_binary_cleanup_rechecks_locked_running_state(score_service_session):
    from types import SimpleNamespace
    from app.core.exceptions import ValidationException
    from app.shared.error_codes import CustomerErrorCode

    db, _ = score_service_session
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_started_at=utc_now(),
        job_uuid="running-cleanup",
        user_id=1,
        state=ImportJobState.PROCESSING,
    )
    if job.state == ImportJobState.FAILED:
        set_failure_facts(
            job,
            DurableFailure(
                "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
            ),
        )
    db.add(job)
    db.flush()
    db.add(ImportDispatch(job_id=job.id))
    db.commit()
    with pytest.raises(ValidationException) as error:
        ImportJobDeletionService().cleanup_binary_artifacts(
            db, SimpleNamespace(id=job.id, state=ImportJobState.CONFIRMED), 1
        )
    assert error.value.code == CustomerErrorCode.JOB_RUNNING
    assert db.get(ImportJob, job.id) is not None


@pytest.mark.parametrize("keep_job", [False, True])
def test_import_release_requires_delivery_ownership(score_service_session, keep_job):
    db, _ = score_service_session
    job = ImportJob(
        requested_options=encode_requested_options(None),
        processing_finished_at=utc_now(),
        job_uuid="missing-delivery",
        user_id=1,
        state=ImportJobState.FAILED,
        failure_code="import_pipeline_failed",
        failure_stage="pipeline",
        failure_classification="system_error",
        failure_retryable=False,
    )
    db.add(job)
    db.commit()
    identity = job.id
    service = ImportJobDeletionService()
    release = service.cleanup_binary_artifacts if keep_job else service.delete_job
    with pytest.raises(RuntimeError, match="requires a durable dispatch"):
        release(db, job, 1)
    assert db.get(ImportJob, identity) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("state", list(ImportJobState))
async def test_customer_delete_http_state_matrix_preserves_owned_data(score_service_session, state):
    from httpx import ASGITransport, AsyncClient
    from app.api.deps import get_current_user, get_db
    from app.main import app
    from app.shared.error_codes import CustomerErrorCode

    db, storage = score_service_session
    job = ImportJob(
        requested_options=encode_requested_options(None),
        job_uuid="http-delete",
        user_id=1,
        state=ImportJobState.READY_FOR_REVIEW if state == ImportJobState.CONFIRMED else state,
        processing_started_at=utc_now() if state != ImportJobState.QUEUED else None,
        processing_finished_at=utc_now()
        if state
        in {ImportJobState.READY_FOR_REVIEW, ImportJobState.CONFIRMED, ImportJobState.FAILED}
        else None,
    )
    if job.state == ImportJobState.FAILED:
        set_failure_facts(
            job,
            DurableFailure(
                "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
            ),
        )
    db.add(job)
    db.flush()
    db.add(ImportDispatch(job_id=job.id))
    artifact_object = object_from_bytes(
        object_key="jobs/matrix-review.musicxml",
        content=b"<score-partwise/>",
        content_type="application/xml",
    )
    upload_object = object_from_bytes(
        object_key="uploads/matrix-original", content=b"original", content_type="image/jpeg"
    )
    db.add_all([artifact_object, upload_object])
    db.flush()
    upload = Upload(
        uploader_user_id=1, stored_object_id=upload_object.id, original_filename="original.jpg"
    )
    db.add(upload)
    db.flush()
    db.add(ImportJobUpload(job_id=job.id, upload_id=upload.id, page_number=1, sort_order=1))
    db.add(
        ImportArtifact(
            job_id=job.id,
            kind=ImportArtifactKind.REVIEW_MUSICXML,
            filename="review.musicxml",
            stored_object_id=artifact_object.id,
        )
    )
    db.commit()
    job_id, upload_id = job.id, upload.id
    for category, obj in [
        (StorageUsageCategory.TEMP_IMPORT, artifact_object),
        (StorageUsageCategory.UPLOAD, upload_object),
    ]:
        storage.put_bytes(
            key=obj.object_key,
            content=b"artifact" if category == StorageUsageCategory.TEMP_IMPORT else b"original",
            content_type=obj.content_type,
        )
        storage_usage_service.record_allocation(
            db,
            user_id=1,
            category=category,
            bytes_count=obj.byte_size,
            reason="seed",
            object_type="test",
        )
    if state == ImportJobState.CONFIRMED:
        score = Score(
            score_uuid="formal-score",
            display_title="Formal",
            owner_user_id=1,
            created_from_import_job_id=job_id,
        )
        db.add(score)
        db.flush()
        from app.modules.import_jobs.lifecycle import mark_confirmed

        mark_confirmed(job, now=utc_now())
        db.commit()
        score_id = score.id
    db.commit()

    def database():
        yield db

    def user():
        return db.get(User, 1)

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.delete("/api/v1/import-jobs/http-delete")
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
    allowed = state in {ImportJobState.READY_FOR_REVIEW, ImportJobState.FAILED}
    assert response.status_code == (204 if allowed else 422), response.text
    if not allowed:
        assert response.json()["code"] == (
            CustomerErrorCode.JOB_RUNNING
            if state == ImportJobState.PROCESSING
            else CustomerErrorCode.VALIDATION_ERROR
        )
    assert (db.get(ImportJob, job_id) is None) == allowed
    assert (db.scalar(select(ImportDispatch)) is None) == allowed
    assert (db.scalar(select(ImportArtifact)) is None) == allowed
    assert (db.get(Upload, upload_id) is None) == allowed
    assert (db.scalar(select(ImportJobUpload)) is None) == allowed
    counters = list(db.scalars(select(StorageUsageCounter)))
    assert sum(c.used_bytes for c in counters) == (
        0 if allowed else artifact_object.byte_size + upload_object.byte_size
    )
    retirements = list(db.scalars(select(StoredObjectRetirement)))
    assert len(retirements) == (2 if allowed else 0)
    if state == ImportJobState.CONFIRMED:
        assert db.get(Score, score_id).created_from_import_job_id == job_id
