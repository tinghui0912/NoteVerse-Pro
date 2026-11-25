"""Probe logic only: these doubles are never evidence of OSS qualification."""

import base64
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from botocore.exceptions import ClientError, ConnectionClosedError
import pytest

from tests.support import qualify_asset_provider as probe


def missing(code="NoSuchUpload"):
    return ClientError(
        {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": 404}}, "probe"
    )


class ProviderDouble:
    def __init__(self, prefix):
        self.prefix = prefix
        self.uploads = set()
        self.objects = set()
        self.versions = set()
        self.markers = set()
        self.aborted = []
        self.deleted = []
        self.abort_errors = {}
        self.delete_errors = {}
        self.listing_errors = {}
        self.list_counts = {}
        self.pages = []

    def get_paginator(self, name):
        def paginate(**kwargs):
            self.list_counts[name] = self.list_counts.get(name, 0) + 1
            error = self.listing_errors.get((name, self.list_counts[name]))
            if error:
                raise error
            assert kwargs["Prefix"].startswith(self.prefix)
            if name == "list_multipart_uploads":
                items = [{"Key": k, "UploadId": u} for k, u in sorted(self.uploads)]
                field = "Uploads"
            elif name == "list_objects_v2":
                items = [{"Key": k} for k in sorted(self.objects)]
                field = "Contents"
            else:
                for field, items in (("Versions", self.versions), ("DeleteMarkers", self.markers)):
                    for key, version in sorted(items):
                        self.pages.append(name)
                        yield {field: [{"Key": key, "VersionId": version}]}
                return
            # One item per page, including different keys and unknown upload IDs.
            for item in items:
                self.pages.append(name)
                yield {field: [item]}

        return SimpleNamespace(paginate=paginate)

    def create_multipart_upload(self, **kwargs):
        pair = (kwargs["Key"], "provider-handle")
        self.uploads.add(pair)
        return {"UploadId": pair[1], "ResponseMetadata": {}}

    def abort_multipart_upload(self, **kwargs):
        pair = (kwargs["Key"], kwargs["UploadId"])
        self.aborted.append(pair)
        error = self.abort_errors.pop(pair, None)
        if error:
            raise error
        if pair not in self.uploads:
            raise missing()
        self.uploads.remove(pair)

    def delete_object(self, **kwargs):
        pair = (kwargs["Key"], kwargs.get("VersionId"))
        self.deleted.append(pair)
        if pair in self.delete_errors:
            raise self.delete_errors[pair]
        if pair[1] is None:
            self.objects.discard(pair[0])
        else:
            self.versions.discard(pair)
            self.markers.discard(pair)

    def head_object(self, **kwargs):
        if kwargs["Key"] not in self.objects:
            raise missing("NoSuchKey")
        return {}


@pytest.fixture
def qualification():
    # Bypass real SDK construction; no credential lookup and no network in this suite.
    q = object.__new__(probe.Qualification)
    q.prefix = "architecture-qualification/isolated-test/"
    q.bucket = "test-only"
    q.origin = "http://localhost:3000"
    q.keys, q.uploads = set(), set()
    q.unsettled_io = False
    q.report = {"checks": {}}
    q.client = ProviderDouble(q.prefix)
    q.signing = Mock()
    return q


def cleanup_result(q):
    q.cleanup()
    return q.report["checks"]["cleanup"]


def test_no_such_upload_is_idempotent_but_final_inventories_are_required(qualification):
    q = qualification
    q.uploads.add((q.prefix + "gone", "old-handle"))
    result = cleanup_result(q)
    assert result["status"] == "PASS"
    assert (
        result["remaining_uploads"]
        == result["remaining_versions"]
        == result["remaining_delete_markers"]
        == 0
    )
    assert result["stages"]["verify_objects"]["status"] == "PASS"


def test_network_abort_failure_does_not_prevent_second_upload_cleanup(qualification):
    q = qualification
    first, second = (q.prefix + "a", "a-id"), (q.prefix + "b", "b-id")
    q.uploads.update((first, second))
    q.client.uploads.update((first, second))
    q.client.abort_errors[first] = ConnectionClosedError(
        endpoint_url="https://secret.invalid/?signed=private"
    )
    result = cleanup_result(q)
    assert second in q.client.aborted
    assert not q.client.uploads
    assert result["status"] == "BLOCKED"  # Even successful later discovery is not a late-IO proof.
    assert result["unsettled_io"]
    assert result["stages"]["abort_registered"]["failures"] == [{"code": "ConnectionClosedError"}]
    assert "private" not in json.dumps(result)


def test_cleanup_discovers_unregistered_mpu_across_every_page(qualification):
    q = qualification
    pairs = {(q.prefix + "a", "a"), (q.prefix + "b", "b"), (q.prefix + "b", "c")}
    q.client.uploads.update(pairs)
    result = cleanup_result(q)
    assert result["status"] == "PASS"
    assert set(q.client.aborted) == pairs
    assert q.client.pages.count("list_multipart_uploads") == 3


def test_orphan_receipt_is_removed_and_only_discovered_handle_is_aborted(qualification):
    q = qualification
    q.orphan_discovery()
    record = q.report["checks"]["unknown_initiate_orphan_discovery"]
    assert record["application_registration_removed"]
    assert record["discovered_handle_matches"] and record["aborted_using_discovered_handle"]
    assert q.uploads == set() and q.client.uploads == set()
    assert len(q.client.aborted) == 1
    assert record["completed_object_exists"] is False
    assert "network response loss" in record["injection"]
    assert cleanup_result(q)["status"] == "PASS"


def test_object_failure_does_not_stop_other_keys_versions_or_delete_markers(qualification):
    q = qualification
    a, b = q.prefix + "a", q.prefix + "b"
    q.client.objects.update((a, b))
    q.client.versions.update(((a, "v1"), (b, "v2")))
    q.client.markers.add((b, "marker"))
    q.client.delete_errors[(a, None)] = TimeoutError("secret URL")
    result = cleanup_result(q)
    assert (b, None) in q.client.deleted and (b, "marker") in q.client.deleted
    assert not q.client.versions and not q.client.markers
    assert result["status"] == "BLOCKED" and result["remaining_objects"] == 1


def test_versions_and_delete_markers_are_paginated_removed_and_rechecked(qualification):
    q = qualification
    q.client.versions.update(((q.prefix + "a", "v1"), (q.prefix + "a", "v2")))
    q.client.markers.add((q.prefix + "a", "marker"))
    result = cleanup_result(q)
    assert result["status"] == "PASS"
    assert len(q.client.deleted) == 3
    assert q.client.list_counts["list_object_versions"] == 2


def test_failed_version_delete_does_not_skip_remaining_versions_or_markers(qualification):
    q = qualification
    key = q.prefix + "versioned"
    q.client.versions.update(((key, "v1"), (key, "v2")))
    q.client.markers.add((key, "marker"))
    q.client.delete_errors[(key, "v1")] = ConnectionClosedError(endpoint_url="redacted")
    result = cleanup_result(q)
    assert (key, "v2") in q.client.deleted and (key, "marker") in q.client.deleted
    assert result["status"] == "BLOCKED" and result["remaining_versions"] == 1
    assert result["remaining_delete_markers"] == 0


@pytest.mark.parametrize(
    "listing,count_field",
    [
        ("list_multipart_uploads", "remaining_uploads"),
        ("list_objects_v2", "remaining_objects"),
        ("list_object_versions", "remaining_versions"),
    ],
)
def test_unverifiable_final_inventory_is_blocked_not_zero(qualification, listing, count_field):
    q = qualification
    q.client.listing_errors[(listing, 2)] = ConnectionClosedError(endpoint_url="redacted")
    result = cleanup_result(q)
    assert result["status"] == "BLOCKED" and result[count_field] is None
    assert all(
        name in result["stages"] for name in ("verify_mpu", "verify_objects", "verify_versions")
    )


def test_out_of_namespace_result_is_never_aborted_or_deleted(qualification):
    q = qualification
    q.client.uploads.add(("someone-else/key", "private"))
    result = cleanup_result(q)
    assert result["status"] == "BLOCKED"
    assert not q.client.aborted and not q.client.deleted
    assert "someone-else" not in json.dumps(result)


HEADERS = {
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, PUT",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "ETag",
}


@pytest.mark.parametrize(
    "field,value",
    [
        ("Access-Control-Allow-Origin", "https://other.invalid"),
        ("Access-Control-Allow-Methods", "GET"),
        ("Access-Control-Allow-Headers", "x-meta-only"),
        ("Access-Control-Expose-Headers", "Content-Length"),
    ],
)
def test_preflight_rejects_incomplete_cors_evidence(field, value):
    assert (
        probe.cors_preflight_evidence(200, HEADERS | {field: value}, "http://localhost:3000")[
            "status"
        ]
        == "BLOCKED"
    )


def test_preflight_requires_success_status_and_accepts_case_insensitive_tokens():
    assert (
        probe.cors_preflight_evidence(403, HEADERS, "http://localhost:3000")["status"] == "BLOCKED"
    )
    assert probe.cors_preflight_evidence(204, HEADERS, "http://localhost:3000")["status"] == "PASS"


def test_checksum_fields_in_all_three_responses_are_still_not_full_hash_qualification(
    qualification,
):
    q = qualification
    digest = base64.b64encode(hashlib.sha256(b"checksum-observation").digest()).decode()
    q.start = Mock(return_value=(q.prefix + "sha", "handle"))
    q.put_part = Mock(return_value={"ETag": "etag", "ChecksumSHA256": digest})
    q.finish = Mock(return_value={"ChecksumSHA256": digest})
    q.client.head_object = Mock(return_value={"ChecksumSHA256": digest})
    q.read = Mock(return_value=b"checksum-observation")
    q.checksums()
    result = q.report["checks"]["sha256_checksum_observations"]
    assert result["all_three_fields_present"] and result["single_part_fields_match"]
    assert result["status"] == "UNKNOWN"
    q.finish.return_value = {}
    q.checksums()
    assert not q.report["checks"]["sha256_checksum_observations"]["all_three_fields_present"]


def test_absent_lifecycle_is_blocked_not_a_qualified_cleanup_policy(qualification):
    q = qualification
    q.client.get_bucket_lifecycle_configuration = Mock(
        side_effect=missing("NoSuchLifecycleConfiguration")
    )
    q.configuration()
    result = q.report["checks"]["configuration_lifecycle"]
    assert result["status"] == "BLOCKED" and result["configuration_absent"]


def test_browser_receives_url_only_over_stdin_without_file_persistence(
    qualification, monkeypatch, tmp_path
):
    q = qualification
    q.signing.generate_presigned_url.return_value = "https://signed.invalid/?secret=credential"
    response = SimpleNamespace(status=200, headers=HEADERS | {"ETag": "tag"})
    transport = Mock()
    transport.__enter__ = Mock(return_value=response)
    transport.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(probe, "urlopen", Mock(return_value=transport))
    child = Mock(return_value=SimpleNamespace(returncode=0, stdout='{"status":"PASS"}'))
    monkeypatch.setattr(probe.subprocess, "run", child)
    monkeypatch.setattr(Path, "write_text", Mock(side_effect=AssertionError("No URL files")))
    monkeypatch.chdir(tmp_path)
    q.signed_transport(Path("browser.mjs"))
    assert "secret=credential" in child.call_args.kwargs["input"]
    assert "secret=credential" not in json.dumps(q.report)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("flag", ["--browser-target-file", "--browser-barrier"])
def test_removed_file_and_barrier_interfaces_are_rejected(flag, monkeypatch, tmp_path):
    monkeypatch.setattr(
        probe.sys, "argv", ["probe", "--run-isolated", flag, str(tmp_path / "user-file")]
    )
    with pytest.raises(SystemExit) as exc:
        probe.main()
    assert exc.value.code == 2 and not list(tmp_path.iterdir())
