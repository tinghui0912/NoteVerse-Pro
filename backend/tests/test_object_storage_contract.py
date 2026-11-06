"""Shared capability witnesses; network integration requires an explicit test namespace."""

from io import BytesIO
import os
from uuid import uuid4
from urllib.request import Request, urlopen
import pytest
from app.storage import ObjectStorage
from app.storage.s3_compatible import S3CompatibleObjectStorage
from tests.support.object_storage import InMemoryObjectStorage


class ObjectResponse(BytesIO):
    def iter_chunks(self, chunk_size):
        while chunk := self.read(chunk_size):
            yield chunk


class ObjectClient:
    """SDK-boundary fake. This is not an object-store service integration."""

    def __init__(self):
        self.store = InMemoryObjectStorage()

    def put_object(self, *, Bucket, Key, Body, **kwargs):
        self.store.put_bytes(key=Key, content=Body, content_type=kwargs.get("ContentType"))

    def head_object(self, *, Bucket, Key):
        try:
            m = self.store.object_metadata(Key)
        except FileNotFoundError as exc:
            error = RuntimeError("missing")
            error.response = {"Error": {"Code": "NoSuchKey"}}
            raise error from exc
        return {"ContentLength": m.size_bytes, "ContentType": m.content_type}

    def get_object(self, *, Bucket, Key, Range=None):
        data = self.store.read_bytes(Key)
        if Range:
            start, end = Range.removeprefix("bytes=").split("-")
            data = data[int(start or 0) : None if not end else int(end) + 1]
        return {"Body": ObjectResponse(data)}

    def copy_object(self, *, CopySource, Bucket, Key):
        self.store.copy(CopySource["Key"], Key)

    def delete_object(self, *, Bucket, Key):
        self.store.delete(Key)

    def generate_presigned_url(self, *, ClientMethod, Params, ExpiresIn, **kwargs):
        return f"https://objects.example/{Params['Key']}?method={ClientMethod}&expires={ExpiresIn}"


@pytest.fixture(params=["object-map", "concrete-adapter-sdk"])
def storage(request):
    if request.param == "object-map":
        return InMemoryObjectStorage()
    adapter = S3CompatibleObjectStorage()
    adapter._client = ObjectClient()
    return adapter


def assert_object_capabilities(storage: ObjectStorage, prefix: str):
    key, copied = prefix + "/bytes", prefix + "/copy"
    data = b"exact immutable object bytes"
    try:
        storage.put_bytes(key=key, content=data, content_type="application/octet-stream")
        assert storage.exists(key)
        metadata = storage.object_metadata(key)
        assert metadata.size_bytes == len(data)
        assert metadata.content_type == "application/octet-stream"
        assert storage.read_bytes(key) == data
        assert b"".join(storage.iter_bytes(key, chunk_size=3)) == data
        assert b"".join(storage.iter_bytes(key, start=2, end=9, chunk_size=2)) == data[2:10]
        assert b"".join(storage.iter_bytes(key, end=4)) == data[:5]
        storage.copy(key, copied)
        assert storage.read_bytes(copied) == data
        assert storage.object_metadata(copied) == metadata
        target = storage.upload_url(
            key=key, content_type="application/octet-stream", checksum_sha256=""
        )
        assert target.upload_method == "PUT"
        assert target.upload_url.startswith(("http://", "https://"))
        assert target.upload_headers["content-type"] == "application/octet-stream"
        assert storage.download_url(key).startswith(("http://", "https://"))
        assert storage.delete(key) is True
        assert storage.delete(key) is False
        assert not storage.exists(key)
    finally:
        storage.delete(key)
        storage.delete(copied)


def test_object_storage_capability_contract(storage):
    assert_object_capabilities(storage, "unit/" + uuid4().hex)


def test_concrete_adapter_issues_signed_upload_and_download(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "S3_SIGNED_ENDPOINT_URL", "http://localhost:9010")
    storage = S3CompatibleObjectStorage()
    target = storage.upload_url("test/object", content_type="audio/webm", checksum_sha256="ab")
    assert target.upload_method == "PUT"
    assert target.upload_url.startswith("http://localhost:9010/")
    assert "X-Amz-Signature=" in target.upload_url
    assert target.upload_headers == {"content-type": "audio/webm", "x-amz-meta-sha256": "ab"}
    download = storage.download_url("test/object", expires_seconds=43)
    assert "X-Amz-Signature=" in download
    assert "X-Amz-Expires=43" in download


@pytest.mark.skipif(
    not os.environ.get("NOTEVERSE_TEST_OBJECT_STORAGE_ENDPOINT_URL"),
    reason="Dedicated object-store test service is not configured",
)
def test_real_object_store_capabilities_and_direct_upload(monkeypatch):
    from app.core.config import settings

    for field in ("ENDPOINT_URL", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.setattr(
            settings, "S3_" + field, os.environ["NOTEVERSE_TEST_OBJECT_STORAGE_" + field]
        )
    monkeypatch.setattr(settings, "S3_SIGNED_ENDPOINT_URL", None)
    storage = S3CompatibleObjectStorage()
    prefix = "contract-tests/" + uuid4().hex
    assert_object_capabilities(storage, prefix)
    key, data = prefix + "/direct", b"browser direct upload bytes"
    try:
        target = storage.upload_url(
            key, content_type="application/octet-stream", checksum_sha256=""
        )
        with urlopen(
            Request(
                target.upload_url,
                data=data,
                headers=target.upload_headers,
                method=target.upload_method,
            )
        ) as response:
            assert response.status in {200, 201, 204}
        assert storage.read_bytes(key) == data
        with urlopen(storage.download_url(key)) as response:
            assert response.read() == data
    finally:
        storage.delete(key)
