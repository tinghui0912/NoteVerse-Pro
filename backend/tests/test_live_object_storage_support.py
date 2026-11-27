"""The live test transport bounds IO and preserves sanitized cleanup failures."""

from types import SimpleNamespace
from unittest.mock import Mock
import httpx
import pytest
from tests.support.live_object_storage import SignedProviderClient, isolated_provider_namespace


def test_signed_transport_surfaces_unknown_io_without_retrying_or_exposing_capabilities():
    client = SignedProviderClient()
    client.client.close()
    requests = []

    def fail(request):
        requests.append(request)
        raise httpx.ReadTimeout("private signed URL", request=request)

    client.client = httpx.Client(transport=httpx.MockTransport(fail))
    try:
        with pytest.raises(AssertionError, match="part_1: ReadTimeout; outcome UNKNOWN") as error:
            client.request(
                "PUT",
                "https://secret.test/private?signature=credential",
                data=b"part",
                stage="part_1",
            )
        assert "signature" not in str(error.value) and "secret" not in str(error.value)
        assert len(requests) == 1
    finally:
        client.close()


def test_namespace_cleanup_attempts_every_resource_and_reports_incomplete_verification():
    prefix = "contract-tests/" + "a" * 32 + "/"
    pages = {
        "list_multipart_uploads": [
            {
                "Uploads": [
                    {"Key": prefix + "a", "UploadId": "one"},
                    {"Key": prefix + "b", "UploadId": "two"},
                ]
            }
        ],
        "list_objects_v2": [{"Contents": [{"Key": prefix + "a"}, {"Key": prefix + "b"}]}],
        "list_object_versions": [
            {
                "Versions": [{"Key": prefix + "a", "VersionId": "version"}],
                "DeleteMarkers": [{"Key": prefix + "b", "VersionId": "marker"}],
            }
        ],
    }
    storage = SimpleNamespace(
        bucket="internal",
        client=Mock(),
        abort_multipart_upload=Mock(side_effect=[OSError("private"), None]),
        delete=Mock(),
    )
    storage.client.get_paginator.side_effect = lambda name: SimpleNamespace(
        paginate=lambda **kwargs: pages[name]
    )
    with pytest.raises(AssertionError, match="Provider cleanup BLOCKED") as error:
        with isolated_provider_namespace(storage, prefix):
            pass
    assert storage.abort_multipart_upload.call_count == 2
    assert storage.delete.call_count == 2
    assert storage.client.delete_object.call_count == 2
    assert "private" not in str(error.value)


def test_namespace_failure_notes_include_safe_cause_type_not_request_payload():
    prefix = "contract-tests/" + "b" * 32 + "/"
    storage = SimpleNamespace(bucket="private", client=Mock())
    storage.client.get_paginator.return_value.paginate.return_value = [{}]
    with pytest.raises(RuntimeError) as error:
        with isolated_provider_namespace(storage, prefix):
            try:
                raise OSError("signed URL and credential payload")
            except OSError:
                raise RuntimeError("Unavailable") from None
    assert error.value.__notes__ == ["Safe provider cause chain: RuntimeError -> OSError"]
