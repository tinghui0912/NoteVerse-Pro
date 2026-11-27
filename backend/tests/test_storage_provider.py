"""Provider wire contract, failure normalization and multipart handle lifecycle."""

from unittest.mock import Mock
from urllib.parse import urlsplit, parse_qs

import pytest

from app.storage.base import (
    ObjectNotFoundError,
    ObjectStorageUnavailableError,
    ObjectStorageOperationFailedError,
    UploadedPart,
)
from app.storage.s3_compatible import S3CompatibleObjectStorage, ClientError
from tests.support.object_storage import InMemoryObjectStorage


OPERATIONS = {
    "put": lambda s: s.put_bytes(key="k", content=b"x"),
    "read": lambda s: s.read_bytes("k"),
    "metadata": lambda s: s.object_metadata("k"),
    "exists": lambda s: s.exists("k"),
    "stream": lambda s: list(s.iter_bytes("k")),
    "delete": lambda s: s.delete("k"),
    "copy": lambda s: s.copy("k", "target"),
    "put_url": lambda s: s.generate_put_upload_url("k", content_type="image/png", content_length=1),
    "download": lambda s: s.download_url("k"),
    "create": lambda s: s.create_multipart_upload("k", content_type="audio/webm"),
    "part_url": lambda s: s.generate_part_upload_url("k", "u", 1, content_length=1),
    "discovery": lambda s: s.list_multipart_uploads("k"),
    "parts": lambda s: s.list_uploaded_parts("k", "u"),
    "complete": lambda s: s.complete_multipart_upload("k", "u", (UploadedPart(1, "e", 1),)),
    "abort": lambda s: s.abort_multipart_upload("k", "u"),
}


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize(
    "status,code,expected",
    [
        (503, "SlowDown", ObjectStorageUnavailableError),
        (408, "RequestTimeout", ObjectStorageUnavailableError),
        (403, "AccessDenied", ObjectStorageOperationFailedError),
        (400, "InvalidPart", ObjectStorageOperationFailedError),
    ],
)
def test_every_wire_operation_sanitizes_provider_errors(operation, status, code, expected):
    error = ClientError(
        {
            "Error": {"Code": code, "Message": "secret signed URL"},
            "ResponseMetadata": {"HTTPStatusCode": status},
        },
        "provider",
    )
    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    storage._signing_client = storage._client
    for method in (
        "put_object",
        "get_object",
        "head_object",
        "delete_object",
        "copy_object",
        "generate_presigned_url",
        "create_multipart_upload",
        "list_parts",
        "list_multipart_uploads",
        "complete_multipart_upload",
        "abort_multipart_upload",
    ):
        getattr(storage._client, method).side_effect = error
    with pytest.raises(expected) as raised:
        OPERATIONS[operation](storage)
    assert "secret" not in str(raised.value)


@pytest.mark.parametrize("operation", OPERATIONS)
def test_network_failure_retains_uncertain_outcome_for_each_operation(operation):
    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    storage._signing_client = storage._client
    for method in (
        "put_object",
        "get_object",
        "head_object",
        "delete_object",
        "copy_object",
        "generate_presigned_url",
        "create_multipart_upload",
        "list_parts",
        "list_multipart_uploads",
        "complete_multipart_upload",
        "abort_multipart_upload",
    ):
        getattr(storage._client, method).side_effect = OSError("private network detail")
    with pytest.raises(ObjectStorageUnavailableError) as raised:
        OPERATIONS[operation](storage)
    assert "private" not in str(raised.value)


def test_delete_is_one_idempotent_request_and_abort_requires_definitive_404():
    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    storage.delete("k")
    storage.client.delete_object.assert_called_once_with(Bucket=storage.bucket, Key="k")
    storage.client.head_object.assert_not_called()
    for status, code, expected in [
        (404, "NoSuchUpload", None),
        (500, "NoSuchUpload", ObjectStorageUnavailableError),
        (403, "NoSuchUpload", ObjectStorageOperationFailedError),
    ]:
        storage.client.abort_multipart_upload.side_effect = ClientError(
            {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}, "abort"
        )
        if expected:
            with pytest.raises(expected):
                storage.abort_multipart_upload("k", "u")
        else:
            storage.abort_multipart_upload("k", "u")


def test_metadata_distinguishes_native_composite_checksum_from_user_metadata():
    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    storage.client.head_object.return_value = {
        "ContentLength": 3,
        "ETag": "etag",
        "Metadata": {"sha256": "untrusted"},
        "ChecksumSHA256": "native-base64-2",
        "ChecksumType": "COMPOSITE",
    }
    metadata = storage.object_metadata("k")
    assert metadata.etag == "etag" and metadata.checksum_algorithm == "SHA256"
    assert metadata.checksum == "native-base64-2" and metadata.checksum_type == "COMPOSITE"
    del storage.client.head_object.return_value["ChecksumSHA256"]
    assert storage.object_metadata("k").checksum is None


def test_pagination_and_embedded_completion_error():
    from app.storage.base import UploadedPart

    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    storage.client.list_parts.side_effect = [
        {
            "Parts": [{"PartNumber": 1, "ETag": "a", "Size": 8}],
            "IsTruncated": True,
            "NextPartNumberMarker": 1,
        },
        {"Parts": [{"PartNumber": 2, "ETag": "b", "Size": 1}]},
    ]
    parts = storage.list_uploaded_parts("k", "u")
    assert parts == (UploadedPart(1, "a", 8), UploadedPart(2, "b", 1))
    assert storage.client.list_parts.call_args.kwargs["PartNumberMarker"] == 1
    storage.client.complete_multipart_upload.return_value = {"Error": {"Code": "InternalError"}}
    with pytest.raises(ObjectStorageUnavailableError):
        storage.complete_multipart_upload("k", "u", parts)


def test_part_sigv4_binds_handle_number_length_and_expiry(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "S3_SIGNED_ENDPOINT_URL", None)
    storage = S3CompatibleObjectStorage()
    target = storage.generate_part_upload_url(
        "final/key", "exact-handle", 3, content_length=123, expires_in=67
    )
    query = parse_qs(urlsplit(target.upload_url).query)
    assert query["X-Amz-SignedHeaders"] == ["content-length;host"]
    assert query["uploadId"] == ["exact-handle"] and query["partNumber"] == ["3"]
    assert query["X-Amz-Expires"] == ["67"] and target.upload_headers == {"content-length": "123"}


def test_memory_multipart_enforces_lengths_replacement_completion_and_abort():
    storage = InMemoryObjectStorage()
    upload = storage.create_multipart_upload("final", content_type="audio/webm")
    target = storage.generate_part_upload_url("final", upload, 1, content_length=3)
    with pytest.raises(ObjectStorageOperationFailedError):
        storage.receive_upload(target, b"four")
    storage.receive_upload(target, b"one")
    storage.receive_upload(target, b"two")
    parts = storage.list_uploaded_parts("final", upload)
    storage.complete_multipart_upload("final", upload, parts)
    assert storage.read_bytes("final") == b"two"
    with pytest.raises(ObjectNotFoundError):
        storage.receive_upload(target, b"one")
    storage.abort_multipart_upload("final", upload)
    other = storage.create_multipart_upload("unadopted", content_type="audio/webm")
    storage.abort_multipart_upload("unadopted", other)
    assert not storage.exists("unadopted")


def test_memory_multipart_assembles_parts_and_rejects_invalid_manifest():
    from dataclasses import replace

    storage = InMemoryObjectStorage()
    upload = storage.create_multipart_upload("final", content_type="audio/webm")
    data = (b"x" * (5 * 1024 * 1024), b"end")
    for number, content in enumerate(data, 1):
        target = storage.generate_part_upload_url(
            "final", upload, number, content_length=len(content)
        )
        storage.receive_upload(target, content)
    parts = storage.list_uploaded_parts("final", upload)
    with pytest.raises(ObjectStorageOperationFailedError):
        storage.complete_multipart_upload(
            "final", upload, (replace(parts[0], etag="wrong"), parts[1])
        )
    storage.complete_multipart_upload("final", upload, parts)
    assert storage.read_bytes("final") == b"".join(data)


def test_signature_expiry_uses_settings_and_requires_integer_lengths(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS", 83)
    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    storage.generate_put_upload_url("k", content_type="image/png", content_length=1)
    assert storage.client.generate_presigned_url.call_args.kwargs["ExpiresIn"] == 83
    for value in (True, 0, -1, 1.5):
        with pytest.raises(ValueError):
            storage.generate_part_upload_url("k", "u", 1, content_length=value)


@pytest.mark.parametrize("failure", ["socket", "stream", "incomplete"])
def test_lazy_stream_error_is_normalized_and_body_closed(failure):
    from app.storage.s3_compatible import ResponseStreamingError, IncompleteReadError

    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    body = Mock()

    def chunks(**kwargs):
        yield b"first"
        raise {
            "socket": OSError("private network detail"),
            "stream": ResponseStreamingError(error="private network detail"),
            "incomplete": IncompleteReadError(actual_bytes=1, expected_bytes=5),
        }[failure]

    body.iter_chunks.side_effect = chunks
    storage.client.get_object.return_value = {"Body": body}
    iterator = storage.iter_bytes("k")
    assert next(iterator) == b"first"
    with pytest.raises(ObjectStorageUnavailableError):
        next(iterator)
    body.close.assert_called_once()


def test_multipart_discovery_paginates_and_matches_exact_key():
    storage = S3CompatibleObjectStorage()
    storage._client = Mock()
    storage._mutation_client = storage._client
    storage.client.list_multipart_uploads.side_effect = [
        {
            "Uploads": [
                {"Key": "exact", "UploadId": "one"},
                {"Key": "exact/other", "UploadId": "foreign"},
            ],
            "IsTruncated": True,
            "NextKeyMarker": "exact",
            "NextUploadIdMarker": "one",
        },
        {"Uploads": [{"Key": "exact", "UploadId": "two"}], "IsTruncated": False},
    ]
    assert storage.list_multipart_uploads("exact") == ("one", "two")
    assert storage.client.list_multipart_uploads.call_args.kwargs["UploadIdMarker"] == "one"
    assert storage.client.list_multipart_uploads.call_args.kwargs["Prefix"] == "exact"


@pytest.mark.parametrize(
    "endpoint,region,path_style",
    [
        ("https://oss.region.example", "region", False),
        ("https://cos.region.example", "region", False),
        ("https://s3.region.example", "region", False),
        ("https://account.storage.example", "auto", True),
    ],
)
def test_s3_connection_policy_is_configured_without_provider_branches(
    monkeypatch, endpoint, region, path_style
):
    from app.core.config import settings

    for name, value in {
        "S3_ENDPOINT_URL": endpoint,
        "S3_SIGNED_ENDPOINT_URL": None,
        "S3_REGION": region,
        "S3_BUCKET": "private-test",
        "S3_ACCESS_KEY_ID": "test-key",
        "S3_SECRET_ACCESS_KEY": "test-secret",
        "S3_FORCE_PATH_STYLE": path_style,
        "S3_CONNECT_TIMEOUT_SECONDS": 7,
        "S3_READ_TIMEOUT_SECONDS": 31,
        "S3_MAX_ATTEMPTS": 4,
    }.items():
        monkeypatch.setattr(settings, name, value)
    storage = S3CompatibleObjectStorage()
    try:
        for client in (storage.client, storage.mutation_client):
            config = client.meta.config
            assert client.meta.endpoint_url == endpoint
            assert client.meta.region_name == region
            assert config.signature_version == "s3v4"
            assert config.connect_timeout == 7 and config.read_timeout == 31
            assert config.s3["addressing_style"] == ("path" if path_style else "virtual")
            assert config.retries["mode"] == "standard"
        assert storage.client.meta.config.retries["total_max_attempts"] == 4
        assert storage.mutation_client.meta.config.retries["total_max_attempts"] == 1
    finally:
        storage.client.close()
        storage.mutation_client.close()
