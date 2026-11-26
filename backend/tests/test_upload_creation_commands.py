"""Stable Upload command identity closes duplicate and uncertain-COMMIT allocations."""

from app.composition import storage_resources as _resource_wiring

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Barrier
import pytest
from fastapi import UploadFile
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.exceptions import ConflictException, FileException, ResourceNotFoundException
from app.db.models import User, Upload, UploadCreationRequest, StorageQuotaHold, StorageUsageAccount
from app.modules.storage_governance.quota.states import StorageQuotaHoldStatus
from app.modules.uploads.service import UploadService
from tests.support.images import image_bytes
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.storage_state import provision_storage_users


@pytest.fixture
def uploads(postgres_engine):
    with Session(postgres_engine) as db:
        db.add(User(id=1, email="upload-command@example.test", password_hash="hash"))
        db.flush()
        provision_storage_users(db)
        db.commit()
    return postgres_engine, InMemoryObjectStorage()


def upload(db, storage, key="stable", name="image.png"):
    return UploadService(
        quota=_resource_wiring.storage_quota_service,
        usage=_resource_wiring.storage_usage_service,
        writes=_resource_wiring.build_object_write_coordinator(storage),
    ).create_upload(
        db,
        db.get(User, 1),
        UploadFile(filename=name, file=BytesIO(image_bytes())),
        client_request_id=key,
    )


def test_duplicate_and_conflicting_commands_preserve_one_allocation(uploads):
    engine, storage = uploads
    with Session(engine) as db:
        first = upload(db, storage)
        assert upload(db, storage).upload_id == first.upload_id
        with pytest.raises(ConflictException):
            upload(db, storage, name="different.png")
        db.rollback()
        assert db.scalar(select(func.count()).select_from(Upload)) == 1
        assert db.scalar(select(func.count()).select_from(StorageQuotaHold)) == 1
        assert db.get(StorageUsageAccount, 1).used_bytes == len(image_bytes())


def test_concurrent_same_command_adopts_once(uploads):
    engine, storage = uploads
    barrier = Barrier(2)

    def run():
        with Session(engine) as db:
            barrier.wait()
            return upload(db, storage).upload_id

    with ThreadPoolExecutor(2) as pool:
        assert len(set(pool.map(lambda _: run(), range(2)))) == 1
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Upload)) == 1
        assert db.get(StorageUsageAccount, 1).used_bytes == len(image_bytes())


@pytest.mark.parametrize("committed", [False, True])
def test_unknown_commit_uses_persisted_completion_not_acknowledgement(
    uploads, monkeypatch, committed
):
    engine, storage = uploads
    with Session(engine) as db:
        original = db.commit
        failed = False

        def uncertain():
            nonlocal failed
            completed = db.scalar(select(UploadCreationRequest.completed_at)) is not None
            if completed and not failed:
                failed = True
                if committed:
                    original()
                raise RuntimeError("lost COMMIT acknowledgement")
            original()

        monkeypatch.setattr(db, "commit", uncertain)
        if committed:
            assert upload(db, storage).upload_id
        else:
            with pytest.raises(FileException):
                upload(db, storage)
        assert failed
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Upload)) == int(committed)
        assert db.get(StorageUsageAccount, 1).used_bytes == (len(image_bytes()) if committed else 0)
        assert db.scalar(select(StorageQuotaHold.status)) == (
            StorageQuotaHoldStatus.CONSUMED if committed else StorageQuotaHoldStatus.RELEASED
        )
        result = upload(db, storage)
        assert result.upload_id
        assert db.scalar(select(func.count()).select_from(Upload)) == 1
        assert db.get(StorageUsageAccount, 1).used_bytes == len(image_bytes())


def test_replay_after_semantic_delete_never_recreates_resource(uploads):
    engine, storage = uploads
    with Session(engine) as db:
        first = upload(db, storage)
        UploadService(
            quota=_resource_wiring.storage_quota_service,
            usage=_resource_wiring.storage_usage_service,
            writes=_resource_wiring.build_object_write_coordinator(storage),
        ).delete_upload(db, db.get(User, 1), first.upload_id)
        db.commit()
        with pytest.raises(ResourceNotFoundException):
            upload(db, storage)
        db.rollback()
        assert db.scalar(select(func.count()).select_from(Upload)) == 0
        assert db.get(StorageUsageAccount, 1).used_bytes == 0
