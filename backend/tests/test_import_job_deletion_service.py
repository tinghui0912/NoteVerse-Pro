"""Import semantic release succeeds independently of another physical owner."""

import pytest
from sqlalchemy import select
from app.db.models import (
    ImportJob,
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
from app.modules.storage_usage.service import storage_usage_service
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
    AsyncSessionAdapter,
)
from tests.support.retirement import drain_retirements


@pytest.mark.asyncio
@pytest.mark.parametrize("shared", [False, True])
@pytest.mark.parametrize("keep_job", [False, True])
async def test_import_release_accounts_atomically_and_protects_other_owners(
    score_service_session, shared, keep_job
):
    db, storage = score_service_session
    job = ImportJob(job_uuid="release-job", user_id=1, state=ImportJobState.PENDING_REVIEW)
    db.add(job)
    db.flush()
    content = b"verified import"
    obj = object_from_bytes(object_key="jobs/committed", content=content, content_type="image/jpeg")
    db.add(obj)
    db.flush()
    identity = obj.id
    storage.put_bytes(key=obj.object_key, content=content, content_type=obj.content_type)
    db.add(
        ImportArtifact(job_id=job.id, kind="image", filename="page.jpg", stored_object_id=identity)
    )
    if shared:
        db.get(User, 1).avatar_object_id = identity
    db.commit()
    job_id = job.id
    storage_usage_service.record_allocation_sync(
        db,
        user_id=1,
        category=StorageUsageCategory.TEMP_IMPORT,
        bytes_count=len(content),
        reason="test",
        object_type="import_artifact",
    )
    service = ImportJobDeletionService()
    release = service.cleanup_binary_artifacts if keep_job else service.delete_job
    await release(AsyncSessionAdapter(db), job, 1)
    assert (db.get(ImportJob, job_id) is not None) is keep_job
    assert db.scalar(select(ImportArtifact)) is None
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
