"""Same-user classification preserves admitted occupancy; extra semantic inputs need capacity."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.exceptions import ValidationException, UnauthorizedException
from app.db.models import (
    User,
    ImportJobState,
    Score,
    Upload,
    StoredObject,
    ImportJob,
    ImportJobUpload,
    ScoreInputAsset,
    StoragePlanPolicy,
    StorageQuotaHold,
    StorageUsageCategory as Category,
)
from app.modules.import_jobs.requested_options import encode_requested_options
from app.modules.scores.input_asset_lifecycle import score_input_asset_lifecycle as lifecycle
from app.modules.storage_usage.service import storage_usage_service as usage
from app.modules.storage_usage.reconciliation import StorageUsageReconciliation
from app.modules.storage_inventory.composition import build_storage_inventory_registry
from tests.support.storage_state import provision_storage_users


@pytest.fixture
def inputs(postgres_engine):
    with Session(postgres_engine) as db:
        db.add_all(
            [User(id=n, email=f"input{n}@example.test", password_hash="hash") for n in (1, 2)]
        )
        db.flush()
        provision_storage_users(db, default_limit_bytes=8)
        obj = StoredObject(
            object_key="input", byte_size=8, sha256="a" * 64, content_type="image/png"
        )
        db.add(obj)
        db.flush()
        upload = Upload(uploader_user_id=1, original_filename="input.png", stored_object_id=obj.id)
        db.add(upload)
        db.flush()
        for n in (1, 2):
            db.add(
                Score(id=n, score_uuid=f"input-score-{n}", display_title="Input", owner_user_id=1)
            )
            job = ImportJob(
                id=n,
                job_uuid=f"input-job-{n}",
                user_id=1,
                state=ImportJobState.QUEUED,
                requested_options=encode_requested_options(None),
            )
            db.add(job)
            db.flush()
            db.add(ImportJobUpload(job_id=n, upload_id=upload.id, page_number=1, sort_order=1))
        usage.record_allocation(
            db, user_id=1, category=Category.UPLOAD, bytes_count=8, reason="seed"
        )
        db.commit()
    return postgres_engine


def test_zero_quota_allows_net_zero_promotion_and_return(inputs):
    with Session(inputs) as db:
        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = 0
        db.commit()
        lifecycle.promote_import_uploads(db, job_id=1, score_id=1, user_id=1)
        lifecycle.promote_import_uploads(db, job_id=1, score_id=1, user_id=1)
        db.commit()
        assert usage.snapshot_user(db, 1).categories[Category.INPUT_ASSET] == 8
        assert usage.committed_bytes(db, 1) == 8
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 0
        assert lifecycle.release_score_inputs(db, score_id=1, user_id=1) == []
        db.commit()
        assert usage.snapshot_user(db, 1).categories[Category.UPLOAD] == 8
        assert (
            not StorageUsageReconciliation(build_storage_inventory_registry())
            .inspect_user(db, 1)
            .drift
        )


def test_concurrent_promotions_cannot_bypass_positive_capacity(inputs):
    barrier = Barrier(2)

    def promote(n):
        with Session(inputs) as db:
            barrier.wait()
            try:
                lifecycle.promote_import_uploads(db, job_id=n, score_id=n, user_id=1)
                db.commit()
                return "accepted"
            except ValidationException:
                db.rollback()
                return "quota"

    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(promote, [1, 2])) == ["accepted", "quota"]
    with Session(inputs) as db:
        assert db.scalar(select(func.count()).select_from(ScoreInputAsset)) == 1
        assert usage.committed_bytes(db, 1) == 8
        assert (
            not StorageUsageReconciliation(build_storage_inventory_registry())
            .inspect_user(db, 1)
            .drift
        )


def test_cross_user_promotion_is_rejected_without_accounting(inputs):
    with Session(inputs) as db:
        db.get(Score, 1).owner_user_id = 2
        db.commit()
        with pytest.raises(UnauthorizedException):
            lifecycle.promote_import_uploads(db, job_id=1, score_id=1, user_id=2)
        db.rollback()
        assert db.scalar(select(func.count()).select_from(ScoreInputAsset)) == 0
        assert usage.committed_bytes(db, 1) == 8 and usage.committed_bytes(db, 2) == 0
