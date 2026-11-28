"""Opt-in provider integration uses an isolated namespace and verifies cleanup."""

import os
from uuid import uuid4
import httpx
import pytest
from app.storage.s3_compatible import S3CompatibleObjectStorage
from app.storage.base import ObjectNotFoundError
from app.platform.config.storage import ObjectStorageConfig
from app.runtime.customer_api.context import get_context

pytestmark = pytest.mark.skipif(
    os.environ.get("NOTEVERSE_RUN_OBJECT_STORAGE_INTEGRATION") != "1",
    reason="Dedicated development object storage is not enabled",
)


def test_signed_lengths_multipart_copy_and_idempotent_deletion():
    storage = S3CompatibleObjectStorage(
        config=ObjectStorageConfig.model_validate(get_context().settings.model_dump())
    )
    prefix = "noteverse-integration/" + uuid4().hex + "/"
    single, final, multipart, abandoned = [
        prefix + name for name in ("single", "final", "multipart", "abandoned")
    ]
    keys = (single, final, multipart, abandoned)
    handles = []
    try:
        with httpx.Client(timeout=45) as client:
            target = storage.generate_put_upload_url(
                single, content_type="application/octet-stream", content_length=4, expires_in=120
            )
            wrong = client.put(
                target.upload_url,
                headers={"Content-Type": "application/octet-stream"},
                content=b"wrong",
            )
            assert wrong.status_code == 403
            result = client.put(target.upload_url, headers=target.upload_headers, content=b"four")
            assert result.status_code == 200
            assert storage.object_metadata(single).size_bytes == 4
            storage.copy(single, final)
            assert storage.read_bytes(final) == b"four"
            handle = storage.create_multipart_upload(multipart, content_type="audio/webm")
            handles.append((multipart, handle))
            content = (b"x" * (5 * 1024**2), b"end")
            for n, data in enumerate(content, 1):
                part = storage.generate_part_upload_url(
                    multipart, handle, n, content_length=len(data), expires_in=120
                )
                response = client.put(part.upload_url, headers=part.upload_headers, content=data)
                assert response.status_code == 200
            assert storage.list_multipart_uploads(multipart) == (handle,)
            parts = storage.list_uploaded_parts(multipart, handle)
            assert [p.size_bytes for p in parts] == [len(data) for data in content]
            storage.complete_multipart_upload(multipart, handle, parts)
            assert storage.object_metadata(multipart).size_bytes == sum(map(len, content))
            assert storage.list_multipart_uploads(multipart) == ()
            with pytest.raises(ObjectNotFoundError):
                storage.list_uploaded_parts(multipart, handle)
            storage.abort_multipart_upload(multipart, handle)
            assert storage.exists(multipart)
            handles.append(
                (abandoned, storage.create_multipart_upload(abandoned, content_type="audio/webm"))
            )
            storage.abort_multipart_upload(*handles[-1])
            assert storage.list_multipart_uploads(abandoned) == ()
            storage.delete(single)
            storage.delete(single)
            assert not storage.exists(single)
    finally:
        failures = []
        for key in keys:
            try:
                discovered = storage.list_multipart_uploads(key)
                for handle in discovered:
                    storage.abort_multipart_upload(key, handle)
            except Exception as error:
                failures.append(type(error).__name__)
        for key in keys:
            try:
                storage.delete(key)
            except Exception as error:
                failures.append(type(error).__name__)
        try:
            paginator = storage.client.get_paginator("list_object_versions")
            for page in paginator.paginate(Bucket=storage.bucket, Prefix=prefix):
                for item in [*page.get("Versions", []), *page.get("DeleteMarkers", [])]:
                    assert item["Key"].startswith(prefix)
                    storage.client.delete_object(
                        Bucket=storage.bucket, Key=item["Key"], VersionId=item["VersionId"]
                    )
            for key in keys:
                assert not storage.exists(key) and not storage.list_multipart_uploads(key)
            versions = storage.client.list_object_versions(Bucket=storage.bucket, Prefix=prefix)
            assert not versions.get("Versions") and not versions.get("DeleteMarkers")
        except Exception as error:
            failures.append(type(error).__name__)
        assert not failures, "Provider cleanup remains unsettled: " + str(failures)
