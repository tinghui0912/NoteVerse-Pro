"""Probe logic only: these doubles are never evidence of OSS qualification."""

import base64
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from botocore.exceptions import (
    ClientError,
    ConnectionClosedError,
    ReadTimeoutError,
    ConnectTimeoutError,
)
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
        return {"UploadId": pair[1], "ResponseMetadata": {"HTTPStatusCode": 200}}

    def abort_multipart_upload(self, **kwargs):
        pair = (kwargs["Key"], kwargs["UploadId"])
        self.aborted.append(pair)
        error = self.abort_errors.pop(pair, None)
        if error:
            raise error
        if pair not in self.uploads:
            raise missing()
        self.uploads.remove(pair)
        return {"ResponseMetadata": {"HTTPStatusCode": 204}}

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
        return {"ResponseMetadata": {"HTTPStatusCode": 204}}

    def list_parts(self, **kwargs):
        if (kwargs["Key"], kwargs["UploadId"]) not in self.uploads:
            raise missing()
        return {"Parts": [{"PartNumber": 1}], "IsTruncated": False}

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
    q.generations, q.unsettled_operations = {}, []
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
    failure = result["stages"]["abort_registered"]["failures"][0]
    assert (
        failure["code"] == "ConnectionClosedError"
        and failure["error_category"] == "NETWORK_UNCERTAIN"
    )
    assert q.unsettled_operations[0]["operation"] == "AbortMultipartUpload"
    assert q.unsettled_operations[0]["key"] == first[0]
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
    child = Mock(
        return_value=SimpleNamespace(
            returncode=0, stdout='{"status":"PASS","http_status":200,"etag_visible":true}'
        )
    )
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


def provider_error(code, status):
    return ClientError(
        {
            "Error": {"Code": code, "Message": "secret body must never be logged"},
            "ResponseMetadata": {"HTTPStatusCode": status},
        },
        "probe",
    )


def sdk_success(status=200):
    return {"ResponseMetadata": {"HTTPStatusCode": status}, "ETag": "etag"}


@pytest.mark.parametrize(
    "code,http,status,unsettled",
    [
        ("InvalidPart", 400, "PASS", False),
        ("AccessDenied", 403, "BLOCKED", False),
        ("InvalidAccessKeyId", 403, "BLOCKED", False),
        ("NoSuchUpload", 404, "UNKNOWN", False),
        ("InternalError", 500, "BLOCKED", True),
        ("RequestTimeout", 408, "BLOCKED", True),
        ("InvalidPart", 200, "UNKNOWN", False),
    ],
)
def test_invalid_completion_requires_exact_expected_provider_rejection(
    qualification, code, http, status, unsettled
):
    q = qualification
    q.put_part = Mock(return_value=sdk_success())
    q.client.complete_multipart_upload = Mock(side_effect=provider_error(code, http))
    q.invalid_completion()
    result = q.report["checks"]["invalid_completion"]
    assert result["status"] == status
    assert result["expected_error"] == {"code": "InvalidPart", "http_status": 400}
    assert result["observed_error"] == code and result["http_status"] == http
    assert q.unsettled_io == unsettled
    assert q.report["checks"]["embedded_error_in_http_200"]["status"] == (
        "PASS" if code == "InvalidPart" and http == 200 else "UNKNOWN"
    )
    assert "secret body" not in json.dumps(q.report)


def test_accepting_invalid_etag_fails_qualification(qualification):
    q = qualification
    q.put_part = Mock(return_value=sdk_success())
    q.client.complete_multipart_upload = Mock(return_value=sdk_success())
    q.invalid_completion()
    assert q.report["checks"]["invalid_completion"]["status"] == "FAIL"
    assert q.report["checks"]["embedded_error_in_http_200"]["status"] == "UNKNOWN"


@pytest.mark.parametrize(
    "operation,method",
    [
        ("CreateMultipartUpload", "create_multipart_upload"),
        ("UploadPart", "upload_part"),
        ("CompleteMultipartUpload", "complete_multipart_upload"),
        ("AbortMultipartUpload", "abort_multipart_upload"),
        ("CopyObject", "copy_object"),
        ("UploadPartCopy", "upload_part_copy"),
        ("DeleteObject", "delete_object"),
    ],
)
@pytest.mark.parametrize("status", [408, 500, 503])
def test_all_side_effect_boundaries_preserve_ambiguous_http_responsibility(
    qualification, operation, method, status
):
    q = qualification
    key = q.key("uncertain")
    setattr(q.client, method, Mock(side_effect=provider_error("InternalError", status)))
    result = q.request_outcome(operation, key)
    assert result["outcome"] == "UNCERTAIN" and q.unsettled_io
    assert q.unsettled_operations == [result]
    assert result["operation"] == operation and result["key"] == key
    assert (
        result["generation"] == q.generations[key] and result["error_category"] == "AMBIGUOUS_HTTP"
    )
    assert "secret body" not in json.dumps(result)


@pytest.mark.parametrize(
    "error",
    [
        ConnectionClosedError(endpoint_url="secret"),
        ReadTimeoutError(endpoint_url="secret"),
        ConnectTimeoutError(endpoint_url="secret"),
    ],
)
def test_network_timeouts_are_uncertain_for_mutation_but_not_read_only_inspection(
    qualification, error
):
    q = qualification
    key = q.key("network")
    read = q.observe_error(error, operation="GetBucketPolicy")
    assert read["outcome"] == "UNCERTAIN" and not q.unsettled_io
    q.client.abort_multipart_upload = Mock(side_effect=error)
    result = q.request_outcome("AbortMultipartUpload", key)
    assert result["outcome"] == "UNCERTAIN" and q.unsettled_io
    assert result["error_category"] == "NETWORK_UNCERTAIN"


@pytest.mark.parametrize(
    "code,status",
    [
        ("AccessDenied", 403),
        ("InvalidAccessKeyId", 403),
        ("NoSuchUpload", 404),
        ("InvalidPart", 400),
    ],
)
def test_explicit_rejection_is_not_ambiguous_side_effect(qualification, code, status):
    q = qualification
    key = q.key("rejection")
    q.client.abort_multipart_upload = Mock(side_effect=provider_error(code, status))
    outcome = q.request_outcome("AbortMultipartUpload", key)
    assert outcome["outcome"] == "REJECTED" and not q.unsettled_io


def setup_race(q, *, abort_error=None, opponent_error=None, object_exists=False, suffix="race"):
    key = q.key(suffix)
    q.start = Mock(return_value=(key, "handle"))
    q.put_part = Mock(return_value={"ETag": "etag"})
    q.client.abort_multipart_upload = Mock(side_effect=abort_error, return_value=sdk_success(204))
    q.client.upload_part = Mock(side_effect=opponent_error, return_value=sdk_success())
    q.client.complete_multipart_upload = Mock(
        side_effect=opponent_error, return_value=sdk_success()
    )
    q.parts = Mock(side_effect=missing())
    q.client.head_object = (
        Mock(return_value={}) if object_exists else Mock(side_effect=missing("NoSuchKey"))
    )
    return key


@pytest.mark.parametrize(
    "name,fault",
    [
        (name, fault)
        for name in ("abort", "upload_abort_race", "complete_abort_race")
        for fault in ("abort500", "opponent500", "abort_disconnect", "opponent_disconnect")
        if name != "abort" or not fault.startswith("opponent")
    ],
)
def test_zero_mpu_does_not_qualify_uncertain_race_results(qualification, name, fault):
    q = qualification
    error = (
        provider_error("InternalError", 500)
        if fault.endswith("500")
        else ConnectionClosedError(endpoint_url="secret")
    )
    setup_race(
        q,
        abort_error=error if fault.startswith("abort") else None,
        opponent_error=error if fault.startswith("opponent") else None,
    )
    q.abort_race(name)
    result = q.report["checks"][name]
    assert result["status"] == "BLOCKED" and result["unsettled_io"]
    assert result["final_inventory"]["mpu"] == "ABSENT"
    assert result["final_inventory"]["completed_object"] == "MISSING"
    assert q.unsettled_operations and cleanup_result(q)["status"] == "BLOCKED"


@pytest.mark.parametrize(
    "opponent_error,object_exists,expected,result_name",
    [
        (None, True, "PASS", "COMPLETED_OBJECT_SURVIVED_ABORT"),
        (None, False, "UNKNOWN", "REQUEST_OBJECT_OBSERVATION_MISMATCH"),
        (missing(), False, "PASS", "COMPLETE_REJECTED_OBJECT_MISSING"),
        (missing(), True, "UNKNOWN", "REQUEST_OBJECT_OBSERVATION_MISMATCH"),
        (provider_error("AccessDenied", 403), False, "UNKNOWN", "UNEXPECTED_REQUEST_REJECTION"),
    ],
)
def test_complete_abort_preserves_request_and_full_object_outcome_matrix(
    qualification, opponent_error, object_exists, expected, result_name
):
    q = qualification
    setup_race(q, opponent_error=opponent_error, object_exists=object_exists)
    q.abort_race("complete_abort_race")
    result = q.report["checks"]["complete_abort_race"]
    assert result["status"] == expected and result["observation"] == result_name
    assert result["abort_outcome"]["outcome"] == "SUCCESS"
    assert result["opponent_outcome"]["operation"] == "CompleteMultipartUpload"


def test_remaining_mpu_is_unfinished_even_when_both_requests_succeeded(qualification):
    q = qualification
    setup_race(q)
    q.parts = Mock(return_value=[])
    q.abort_race("upload_abort_race")
    assert q.report["checks"]["upload_abort_race"]["status"] == "BLOCKED"


@pytest.mark.parametrize("object_exists,expected", [(True, "PASS"), (False, "UNKNOWN")])
def test_abort_no_such_upload_requires_positive_complete_object_evidence(
    qualification, object_exists, expected
):
    q = qualification
    setup_race(q, abort_error=missing(), object_exists=object_exists)
    q.abort_race("complete_abort_race")
    result = q.report["checks"]["complete_abort_race"]
    assert result["status"] == expected
    assert result["abort_outcome"]["code"] == "NoSuchUpload"
    assert result["opponent_outcome"]["outcome"] == "SUCCESS"


@pytest.mark.parametrize(
    "http,error,abort_error",
    [
        (500, None, None),
        (None, ConnectionClosedError(endpoint_url="secret"), None),
        (200, None, None),
        (200, None, provider_error("InternalError", 500)),
    ],
)
def test_inflight_part_requires_known_abort_put_and_object_inventory(
    qualification, monkeypatch, http, error, abort_error
):
    q = qualification
    setup_race(q, abort_error=abort_error)

    def body(target, sent, release):
        sent.set()
        assert release.wait(10)
        if error:
            raise error
        return http

    monkeypatch.setattr(q, "send_partial_part", body)
    q.abort_inflight_part()
    result = q.report["checks"]["abort_inflight_part"]
    assert result["status"] == ("PASS" if http == 200 and abort_error is None else "BLOCKED")
    assert (
        result["opponent_outcome"]["http_status"] == http
        if http is not None
        else result["opponent_outcome"]["code"] == "ConnectionClosedError"
    )
    assert result["final_inventory"]["completed_object"] == "MISSING"


@pytest.mark.parametrize(
    "name,method,data",
    [
        (
            "encryption",
            "get_bucket_encryption",
            {
                "ServerSideEncryptionConfiguration": {
                    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
                }
            },
        ),
        ("policy", "get_bucket_policy", {"Policy": "sensitive policy body"}),
        (
            "cors",
            "get_bucket_cors",
            {
                "CORSRules": [
                    {"AllowedOrigins": ["http://localhost:3000"], "AllowedMethods": ["GET"]}
                ]
            },
        ),
        ("versioning", "get_bucket_versioning", {}),
        (
            "lifecycle",
            "get_bucket_lifecycle_configuration",
            {
                "Rules": [
                    {
                        "Status": "Enabled",
                        "Filter": {"Prefix": "other-prefix/"},
                        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
                    }
                ]
            },
        ),
    ],
)
def test_configuration_read_success_is_only_observation_not_approved_capability(
    qualification, name, method, data
):
    q = qualification
    setattr(q.client, method, Mock(return_value=data))
    q.configuration()
    result = q.report["checks"]["configuration_" + name]
    assert result["inspection_status"] == "PASS" and result["observed_configuration"]
    assert result["qualification_status"] == result["status"] == "UNKNOWN"
    assert "sensitive policy body" not in json.dumps(result)


@pytest.mark.parametrize(
    "browser_result",
    [{"status": "BLOCKED", "http_status": 500}, {"status": "BLOCKED", "error_class": "TypeError"}],
)
def test_browser_uncertain_upload_retains_cleanup_responsibility(
    qualification, monkeypatch, browser_result
):
    q = qualification
    q.signing.generate_presigned_url.return_value = "https://signed.invalid/?secret=credential"
    response = SimpleNamespace(status=200, headers=HEADERS | {"ETag": "tag"})
    transport = Mock()
    transport.__enter__ = Mock(return_value=response)
    transport.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(probe, "urlopen", Mock(return_value=transport))
    monkeypatch.setattr(
        probe.subprocess,
        "run",
        Mock(return_value=SimpleNamespace(returncode=0, stdout=json.dumps(browser_result))),
    )
    q.signed_transport(Path("browser.mjs"))
    assert q.report["checks"]["browser_access"]["status"] == "BLOCKED"
    assert q.unsettled_io and q.unsettled_operations[0]["operation"] == "UploadPart"
    assert "credential" not in json.dumps(q.report)


@pytest.mark.parametrize(
    "code,http,expected",
    [
        ("NoSuchUpload", 404, "PASS"),
        ("NoSuchUpload", 500, "BLOCKED"),
        ("NoSuchUpload", 403, "BLOCKED"),
        ("NoSuchKey", 404, "BLOCKED"),
        ("InternalError", 500, "BLOCKED"),
    ],
)
def test_cleanup_abort_requires_exact_code_and_http_status_with_full_context(
    qualification, code, http, expected
):
    q = qualification
    key = q.key("cleanup-status")
    q.uploads.add((key, "handle"))
    q.client.abort_errors[(key, "handle")] = provider_error(code, http)
    result = cleanup_result(q)
    stage = result["stages"]["abort_registered"]
    assert result["status"] == expected and stage["status"] == expected
    if expected == "BLOCKED":
        error = stage["failures"][0]
        assert {k: error[k] for k in ("operation", "key", "generation", "http_status", "code")} == {
            "operation": "AbortMultipartUpload",
            "key": key,
            "generation": q.generations[key],
            "http_status": http,
            "code": code,
        }
        assert error["error_category"] == (
            "AMBIGUOUS_HTTP" if http == 500 else "EXPLICIT_REJECTION"
        )
    assert q.unsettled_io == (http == 500)


def test_independent_races_do_not_inherit_each_others_failures_but_namespace_retains_responsibility(
    qualification,
):
    q = qualification
    first_key = setup_race(q, abort_error=provider_error("InternalError", 500), suffix="unknown-a")
    q.abort_race("abort")
    assert q.report["checks"]["abort"]["status"] == "BLOCKED"
    second_key = setup_race(q, suffix="healthy-b")
    q.abort_race("upload_abort_race")
    second = q.report["checks"]["upload_abort_race"]
    assert first_key != second_key and second["status"] == "PASS"
    assert not second["unsettled_io"] and second["namespace_unsettled_io"]
    assert second["race_unsettled_operations"] == []
    assert cleanup_result(q)["status"] == "BLOCKED"
    assert q.unsettled_operations[0]["key"] == first_key


@pytest.mark.parametrize(
    "abort_missing,name",
    [(False, "COMPLETED_OBJECT_SURVIVED_ABORT"), (True, "COMPLETE_WON_ABORT_NO_SUCH_UPLOAD")],
)
def test_completed_object_race_name_identifies_whether_abort_actually_succeeded(
    qualification, abort_missing, name
):
    q = qualification
    setup_race(q, abort_error=missing() if abort_missing else None, object_exists=True)
    q.abort_race("complete_abort_race")
    result = q.report["checks"]["complete_abort_race"]
    assert result["status"] == "PASS" and result["observation"] == name


@pytest.mark.parametrize(
    "physical,expected",
    [
        ({"mpu": "PRESENT", "parts": 1, "completed_object": "MISSING"}, "PASS"),
        ({"mpu": "PRESENT", "parts": 0, "completed_object": "MISSING"}, "UNKNOWN"),
        ({"mpu": "ABSENT", "parts": 0, "completed_object": "MISSING"}, "UNKNOWN"),
        ({"mpu": "PRESENT", "parts": 1, "completed_object": "EXISTS"}, "UNKNOWN"),
        ({"mpu": "ABSENT", "parts": 0, "completed_object": "EXISTS"}, "UNKNOWN"),
        ({"mpu": "UNKNOWN", "parts": None, "completed_object": "UNKNOWN"}, "UNKNOWN"),
    ],
)
def test_invalid_part_400_alone_does_not_qualify_inconsistent_physical_inventory(
    qualification, physical, expected
):
    q = qualification
    q.put_part = Mock(return_value=sdk_success())
    q.client.complete_multipart_upload = Mock(side_effect=provider_error("InvalidPart", 400))
    q.inspect_transfer = Mock(return_value=physical)
    q.invalid_completion()
    result = q.report["checks"]["invalid_completion"]
    assert result["status"] == expected and result["final_inventory"] == physical
    assert result["observed_error"] == "InvalidPart" and result["http_status"] == 400


def test_raw_part_and_signed_browser_successes_have_full_correlation(qualification, monkeypatch):
    q = qualification
    key = setup_race(q, suffix="raw")

    def body(target, sent, release):
        sent.set()
        assert release.wait(10)
        return 200

    monkeypatch.setattr(q, "send_partial_part", body)
    q.abort_inflight_part()
    raw = q.report["checks"]["abort_inflight_part"]["opponent_outcome"]
    assert raw == q.success_evidence("UploadPart", key, 200)
    # Exercise actual signed transport logic; only network responses are doubled.
    q.start = Mock(return_value=(key, "handle"))
    q.signing.generate_presigned_url.return_value = "https://signed.invalid/?secret=private"
    response = SimpleNamespace(status=200, headers=HEADERS | {"ETag": "tag"})
    transport = Mock()
    transport.__enter__ = Mock(return_value=response)
    transport.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(probe, "urlopen", Mock(return_value=transport))
    monkeypatch.setattr(
        probe.subprocess,
        "run",
        Mock(
            return_value=SimpleNamespace(
                returncode=0, stdout='{"status":"PASS","http_status":200,"etag_visible":true}'
            )
        ),
    )
    q.signed_transport(Path("browser.mjs"))
    for check in ("signed_endpoint_http_access", "browser_access"):
        report = q.report["checks"][check]
        assert all(
            report[k] == raw[k]
            for k in ("operation", "key", "generation", "http_status", "outcome")
        )
        assert report["status"] == "PASS"
    assert "secret=private" not in json.dumps(q.report)
