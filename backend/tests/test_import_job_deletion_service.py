from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock, call

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import StorageBlob, StorageUsageCategory, Upload
from app.modules.import_jobs.deletion_service import (
    ImportJobDeletionService,
    StoredObjectCleanup,
)


class DeletionServiceProbe(ImportJobDeletionService):
    def __init__(self) -> None:
        super().__init__(storage=Mock())
        self.upload = SimpleNamespace(id=31, upload_uuid="upload-1")
        self.blob = SimpleNamespace(
            id=41,
            blob_uuid="blob-1",
            storage_key="uploads/blob-1.png",
            size_bytes=123,
        )
        self.released: list[StoredObjectCleanup] = []

    async def _orphan_uploads_after_job_delete(
        self,
        _db: AsyncSession,
        _job_id: int,
    ) -> list[tuple[Upload, StorageBlob]]:
        return [(cast(Upload, self.upload), cast(StorageBlob, self.blob))]

    async def _collect_delete_cleanup_objects(
        self,
        _db: AsyncSession,
        _job_id: int,
        _orphan_uploads: list[tuple[Upload, StorageBlob]],
    ) -> list[StoredObjectCleanup]:
        return [
            StoredObjectCleanup(
                category=StorageUsageCategory.UPLOAD,
                object_type="storage_blob",
                object_id="blob-1",
                storage_key="uploads/blob-1.png",
                bytes_count=0,
                reason="orphan_blob_deleted",
            )
        ]

    async def _delete_storage_and_release_usage(
        self,
        _db: AsyncSession,
        _user_id: int,
        cleanup_objects: list[StoredObjectCleanup],
    ) -> None:
        self.released.extend(cleanup_objects)


@pytest.mark.asyncio
async def test_import_job_deletion_service_deletes_rows_before_releasing_storage() -> None:
    service = DeletionServiceProbe()
    job = SimpleNamespace(id=17, job_uuid="job-1")
    database = Mock()
    database.delete = AsyncMock()
    database.flush = AsyncMock()
    database.commit = AsyncMock()
    database.get = AsyncMock(return_value=service.blob)

    await service.delete_job(database, job, user_id=7)

    assert database.delete.await_args_list == [
        call(job),
        call(service.upload),
        call(service.blob),
    ]
    assert database.flush.await_count == 2
    database.commit.assert_awaited_once()
    assert [item.object_id for item in service.released] == ["blob-1"]
