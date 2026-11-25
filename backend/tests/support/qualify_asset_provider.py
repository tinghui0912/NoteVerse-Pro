"""Opt-in real-provider probe; never imports or changes application runtime.

Run in the quality image with JSON S3 settings on stdin. Only a fresh UUID prefix
is mutated. No credentials, signed URLs, provider error messages or bucket names
are emitted. This is bounded capability evidence, not a size/performance benchmark.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from threading import Barrier, Event
from http.client import HTTPSConnection
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


def safe_error(error: Exception) -> dict[str, str | int]:
    if isinstance(error, ClientError):
        return {
            "code": str(error.response.get("Error", {}).get("Code", "UNKNOWN")),
            "http_status": int(error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)),
        }
    if isinstance(error, HTTPError):
        return {"code": "HTTPError", "http_status": error.code}
    return {"code": type(error).__name__}


def cors_preflight_evidence(status: int, headers, origin: str) -> dict[str, object]:
    def tokens(name: str) -> set[str]:
        return {v.strip().lower() for v in headers.get(name, "").split(",") if v.strip()}

    methods = tokens("Access-Control-Allow-Methods")
    allowed_headers = tokens("Access-Control-Allow-Headers")
    exposed = tokens("Access-Control-Expose-Headers")
    checks = {
        "http_success": 200 <= status < 300,
        "allow_origin_matches": headers.get("Access-Control-Allow-Origin") in (origin, "*"),
        "put_allowed": "put" in methods or "*" in methods,
        "request_headers_allowed": "content-type" in allowed_headers or "*" in allowed_headers,
        "etag_exposed": "etag" in exposed or "*" in exposed,
    }
    return {
        "status": "PASS" if all(checks.values()) else "BLOCKED",
        "http_status": status,
        **checks,
    }


class Qualification:
    def __init__(self, settings: dict[str, str], origin: str) -> None:
        endpoint = settings["S3_ENDPOINT_URL"].rstrip("/")
        signed_endpoint = (settings.get("S3_SIGNED_ENDPOINT_URL") or endpoint).rstrip("/")
        self.bucket = settings["S3_BUCKET"]
        self.origin = origin
        self.prefix = "architecture-qualification/" + uuid4().hex + "/"
        self.keys: set[str] = set()
        self.uploads: set[tuple[str, str]] = set()
        self.unsettled_io = False
        self.report: dict[str, object] = {
            "schema": 2,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "provider_family": "Aliyun OSS" if "aliyuncs.com" in endpoint else "UNKNOWN",
            "provider_version": "UNKNOWN (managed service)",
            "bucket_fingerprint": hashlib.sha256(self.bucket.encode()).hexdigest()[:12],
            "endpoint_equals_signing_endpoint": endpoint == signed_endpoint,
            "https": endpoint.startswith("https://"),
            "boto3_version": boto3.__version__,
            "test_prefix": self.prefix,
            "origin": origin,
            "checks": {},
        }
        kwargs = {
            "region_name": settings.get("S3_REGION", "auto"),
            "aws_access_key_id": settings["S3_ACCESS_KEY_ID"],
            "aws_secret_access_key": settings["S3_SECRET_ACCESS_KEY"],
            "config": Config(
                signature_version="s3v4",
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                connect_timeout=10,
                read_timeout=30,
                retries={"total_max_attempts": 1},
                s3={
                    "addressing_style": "path"
                    if settings.get("S3_FORCE_PATH_STYLE", "true").lower() == "true"
                    else "virtual",
                    "payload_signing_enabled": False,
                },
            ),
        }
        self.client = boto3.client("s3", endpoint_url=endpoint, **kwargs)
        self.signing = boto3.client("s3", endpoint_url=signed_endpoint, **kwargs)

    def record(self, name: str, status: str = "PASS", **evidence: object) -> None:
        self.report["checks"][name] = {"status": status, **evidence}

    def observe_error(self, error: Exception) -> dict[str, str | int]:
        if isinstance(
            error, (BotoCoreError, OSError, subprocess.TimeoutExpired)
        ) and not isinstance(error, ClientError):
            self.unsettled_io = True
        return safe_error(error)

    def require_scoped_key(self, key: str) -> None:
        if not key.startswith(self.prefix) or key == self.prefix:
            raise ValueError("Provider returned an out-of-scope locator")

    def key(self, suffix: str) -> str:
        key = self.prefix + suffix
        self.keys.add(key)
        return key

    def start(self, suffix: str, **kwargs: object) -> tuple[str, str]:
        key = self.key(suffix)
        result = self.client.create_multipart_upload(
            Bucket=self.bucket, Key=key, ContentType="application/octet-stream", **kwargs
        )
        upload_id = result["UploadId"]
        self.uploads.add((key, upload_id))
        self.report["server_header"] = (
            result["ResponseMetadata"].get("HTTPHeaders", {}).get("server")
        )
        return key, upload_id

    def parts(self, key: str, upload_id: str) -> list[dict[str, object]]:
        result = []
        marker = 0
        while True:
            response = self.client.list_parts(
                Bucket=self.bucket, Key=key, UploadId=upload_id, MaxParts=1, PartNumberMarker=marker
            )
            result.extend(response.get("Parts", []))
            if not response.get("IsTruncated"):
                return result
            following = int(response["NextPartNumberMarker"])
            if following <= marker:
                raise AssertionError("Non-progressing pagination")
            marker = following

    def put_part(self, key: str, upload_id: str, number: int, body: bytes, **kwargs: object):
        return self.client.upload_part(
            Bucket=self.bucket, Key=key, UploadId=upload_id, PartNumber=number, Body=body, **kwargs
        )

    def finish(self, key: str, upload_id: str, parts):
        return self.client.complete_multipart_upload(
            Bucket=self.bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )

    def read(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        try:
            return response["Body"].read()
        finally:
            response["Body"].close()

    def configuration(self) -> None:
        for name, method, absent in [
            ("versioning", "get_bucket_versioning", None),
            (
                "encryption",
                "get_bucket_encryption",
                "ServerSideEncryptionConfigurationNotFoundError",
            ),
            ("policy", "get_bucket_policy", "NoSuchBucketPolicy"),
            ("cors", "get_bucket_cors", "NoSuchCORSConfiguration"),
            ("lifecycle", "get_bucket_lifecycle_configuration", "NoSuchLifecycleConfiguration"),
        ]:
            try:
                data = getattr(self.client, method)(Bucket=self.bucket)
                if name == "versioning":
                    facts = {"versioning_status": data.get("Status", "Disabled")}
                elif name == "encryption":
                    facts = {
                        "algorithms": [
                            r.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm")
                            for r in data.get("ServerSideEncryptionConfiguration", {}).get(
                                "Rules", []
                            )
                        ]
                    }
                elif name == "cors":
                    facts = {
                        "rules": [
                            {
                                k: r.get(k, [])
                                for k in ("AllowedMethods", "AllowedHeaders", "ExposeHeaders")
                            }
                            | {
                                "origin_matches": self.origin in r.get("AllowedOrigins", [])
                                or "*" in r.get("AllowedOrigins", [])
                            }
                            for r in data.get("CORSRules", [])
                        ]
                    }
                elif name == "lifecycle":
                    facts = {
                        "rule_count": len(data.get("Rules", [])),
                        "incomplete_multipart_rules": [
                            {
                                "status": r.get("Status"),
                                "days": r["AbortIncompleteMultipartUpload"].get(
                                    "DaysAfterInitiation"
                                ),
                                "scope": "bucket"
                                if not r.get("Filter") and not r.get("Prefix")
                                else "filtered_scope_not_reported",
                            }
                            for r in data.get("Rules", [])
                            if r.get("AbortIncompleteMultipartUpload")
                        ],
                    }
                else:
                    facts = {
                        "policy_present": bool(data.get("Policy")),
                        "effective_iam": "UNKNOWN; successful probes prove only exercised actions",
                    }
                self.record(
                    "configuration_" + name, "UNKNOWN" if name == "lifecycle" else "PASS", **facts
                )
            except Exception as error:
                facts = self.observe_error(error)
                self.record(
                    "configuration_" + name,
                    "BLOCKED" if name == "lifecycle" and facts.get("code") == absent else "UNKNOWN",
                    configuration_absent=facts.get("code") == absent,
                    **facts,
                )

    def basic(self) -> None:
        key, identity = self.start("multipart")
        self.record("create_multipart")
        body = b"a" * (5 * 1024 * 1024)
        first = self.put_part(key, identity, 1, body)
        replacement = b"b" * len(body)
        second = self.put_part(key, identity, 1, replacement)
        tail = b"qualified-tail"
        self.put_part(key, identity, 2, tail)
        parts = self.parts(key, identity)
        assert len(parts) == 2 and parts[0]["ETag"] == second["ETag"]
        assert first["ETag"] != second["ETag"]
        self.record("upload_part_overwrite", bytes_per_nonfinal_part=len(body))
        self.record("list_parts_pagination", max_parts=1, observed_parts=2)
        completed = self.finish(
            key, identity, [{"PartNumber": p["PartNumber"], "ETag": p["ETag"]} for p in parts]
        )
        actual = self.read(key)
        assert actual == replacement + tail
        self.record(
            "complete_multipart",
            http_status=completed["ResponseMetadata"]["HTTPStatusCode"],
            full_read_sha256=hashlib.sha256(actual).hexdigest(),
        )
        try:
            self.parts(key, identity)
            self.record("no_such_upload_after_completion", "FAIL")
        except ClientError as error:
            assert error.response["Error"]["Code"] == "NoSuchUpload"
            self.client.head_object(Bucket=self.bucket, Key=key)
            self.record("no_such_upload_after_completion", completed_object_exists=True)
        self.client.copy_object(
            Bucket=self.bucket,
            Key=self.key("single-copy"),
            CopySource={"Bucket": self.bucket, "Key": key},
        )
        assert self.read(self.prefix + "single-copy") == actual
        self.record(
            "single_copy_small_object",
            bytes=len(actual),
            actual_maximum="UNKNOWN; no large-object boundary test",
        )
        copy_key, copy_id = self.start("multipart-copy")
        copied = self.client.upload_part_copy(
            Bucket=self.bucket,
            Key=copy_key,
            UploadId=copy_id,
            PartNumber=1,
            CopySource={"Bucket": self.bucket, "Key": key},
            CopySourceRange=f"bytes=0-{len(actual) - 1}",
        )
        self.finish(
            copy_key, copy_id, [{"PartNumber": 1, "ETag": copied["CopyPartResult"]["ETag"]}]
        )
        assert self.read(copy_key) == actual
        self.record("multipart_copy", bytes=len(actual))

    def invalid_completion(self) -> None:
        key, identity = self.start("invalid-completion")
        self.put_part(key, identity, 1, b"invalid-etag-probe")
        try:
            self.finish(key, identity, [{"PartNumber": 1, "ETag": '"' + "0" * 32 + '"'}])
            self.record("invalid_completion", "FAIL")
        except ClientError as error:
            facts = self.observe_error(error)
            self.record("invalid_completion", **facts)
            self.record(
                "embedded_error_in_http_200",
                "PASS" if facts["http_status"] == 200 else "UNKNOWN",
                observed_error_http_status=facts["http_status"],
                note="Only observed provider responses count; no fake success response injection",
            )

    def orphan_discovery(self) -> None:
        key, original_id = self.start("lost-initiation-receipt")
        # This local comparison oracle is never passed to cleanup or Abort.
        self.uploads.remove((key, original_id))
        found = []
        for page in self.client.get_paginator("list_multipart_uploads").paginate(
            Bucket=self.bucket, Prefix=key, PaginationConfig={"PageSize": 1}
        ):
            for upload in page.get("Uploads", []):
                self.require_scoped_key(upload["Key"])
                if upload["Key"] == key:
                    found.append(upload)
        assert len(found) == 1 and found[0]["UploadId"] == original_id
        discovered_id = found[0]["UploadId"]
        self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=discovered_id)
        # No application cleanup registration exists: the discovered handle owns this Abort.
        assert (key, original_id) not in self.uploads
        remaining = []
        for page in self.client.get_paginator("list_multipart_uploads").paginate(
            Bucket=self.bucket, Prefix=key
        ):
            remaining.extend(u for u in page.get("Uploads", []) if u["Key"] == key)
        assert not remaining
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as missing:
            assert missing.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound")
        else:
            raise AssertionError("An uncompleted orphan has a completed object")
        self.record(
            "unknown_initiate_orphan_discovery",
            matching_uploads=1,
            application_registration_removed=True,
            discovered_handle_matches=True,
            aborted_using_discovered_handle=True,
            remaining_uploads=0,
            completed_object_exists=False,
            injection="application receipt discarded; network response loss and internal late IO remain unverified",
        )

    def abort_and_races(self) -> None:
        for operation in ("abort", "upload_abort_race", "complete_abort_race"):
            key, identity = self.start(operation)
            part = self.put_part(key, identity, 1, b"race-data")
            if operation == "abort":
                self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=identity)
                outcomes = []
            else:
                barrier = Barrier(2)

                def compete(action):
                    barrier.wait(timeout=10)
                    try:
                        if action == "abort":
                            self.client.abort_multipart_upload(
                                Bucket=self.bucket, Key=key, UploadId=identity
                            )
                        elif operation == "upload_abort_race":
                            self.put_part(key, identity, 1, b"c" * (5 * 1024 * 1024))
                        else:
                            self.finish(key, identity, [{"PartNumber": 1, "ETag": part["ETag"]}])
                        return {"action": action, "result": "accepted"}
                    except Exception as error:
                        return {"action": action, **self.observe_error(error)}

                with ThreadPoolExecutor(2) as pool:
                    outcomes = list(pool.map(compete, ("abort", "write")))
            try:
                remaining = len(self.parts(key, identity))
                self.record(operation, "UNKNOWN", outcomes=outcomes, remaining_parts=remaining)
            except ClientError as error:
                assert error.response["Error"]["Code"] == "NoSuchUpload"
                try:
                    self.client.head_object(Bucket=self.bucket, Key=key)
                    object_exists = True
                except ClientError as missing:
                    if missing.response["ResponseMetadata"]["HTTPStatusCode"] != 404:
                        raise
                    object_exists = False
                self.record(
                    operation,
                    outcomes=outcomes,
                    upload_absent_after_both_calls_settled=True,
                    completed_object_exists=object_exists,
                    scheduling="simultaneous caller barrier; internal provider overlap not proven",
                )

    def abort_inflight_part(self) -> None:
        key, identity = self.start("abort-inflight-network-part")
        target = self.signing.generate_presigned_url(
            "upload_part",
            Params={"Bucket": self.bucket, "Key": key, "UploadId": identity, "PartNumber": 1},
            ExpiresIn=120,
            HttpMethod="PUT",
        )
        sent, release = Event(), Event()
        body = b"i" * (5 * 1024 * 1024)

        def send_partial():
            address = urlsplit(target)
            if address.scheme != "https":
                raise ValueError("Network in-flight probe requires HTTPS")
            connection = HTTPSConnection(address.hostname, address.port or 443, timeout=30)
            try:
                connection.putrequest("PUT", address.path + "?" + address.query)
                connection.putheader("Content-Length", str(len(body)))
                connection.endheaders()
                connection.send(body[:65536])
                sent.set()
                if not release.wait(30):
                    raise TimeoutError("Probe coordinator did not release body")
                connection.send(body[65536:])
                response = connection.getresponse()
                response.read()
                return response.status
            finally:
                connection.close()

        with ThreadPoolExecutor(1) as pool:
            pending = pool.submit(send_partial)
            try:
                if not sent.wait(10):
                    raise TimeoutError("No request body was sent")
                self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=identity)
            finally:
                release.set()
            try:
                status = pending.result(timeout=35)
                outcome = {"part_http_status": status}
            except Exception as error:
                outcome = self.observe_error(error)
        try:
            remaining = len(self.parts(key, identity))
        except ClientError as error:
            if error.response["Error"]["Code"] != "NoSuchUpload":
                raise
            remaining = 0
        self.record(
            "abort_inflight_part",
            "PASS" if remaining == 0 else "UNKNOWN",
            sent_body_prefix_bytes=65536,
            remaining_parts=remaining,
            **outcome,
            observation="Abort issued after HTTPS headers and body prefix sent, before remaining body; no internal provider ordering claim",
        )

    def checksums(self) -> None:
        body = b"checksum-observation"
        digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
        try:
            key, identity = self.start(
                "sha256", ChecksumAlgorithm="SHA256", ChecksumType="COMPOSITE"
            )
            part = self.put_part(key, identity, 1, body, ChecksumSHA256=digest)
            result = self.finish(
                key, identity, [{"PartNumber": 1, "ETag": part["ETag"], "ChecksumSHA256": digest}]
            )
            head = self.client.head_object(Bucket=self.bucket, Key=key, ChecksumMode="ENABLED")
            assert self.read(key) == body
            self.record(
                "sha256_checksum_observations",
                "UNKNOWN",
                all_three_fields_present=all(r.get("ChecksumSHA256") for r in (part, result, head)),
                single_part_fields_match=all(
                    r.get("ChecksumSHA256") == digest for r in (part, result, head)
                ),
                part_checksum_present=bool(part.get("ChecksumSHA256")),
                completion_checksum_present=bool(result.get("ChecksumSHA256")),
                head_checksum_present=bool(head.get("ChecksumSHA256")),
                full_sha256_independently_verified=True,
                equivalence="UNKNOWN; response does not establish full-object/composite equivalence",
            )
        except Exception as error:
            self.record("sha256_checksum_observations", "UNKNOWN", **self.observe_error(error))

    def signed_transport(self, browser_script: Path | None = None) -> None:
        key, identity = self.start("browser-signed-part")
        target = self.signing.generate_presigned_url(
            "upload_part",
            Params={"Bucket": self.bucket, "Key": key, "UploadId": identity, "PartNumber": 1},
            ExpiresIn=120,
            HttpMethod="PUT",
        )
        try:
            with urlopen(
                Request(target, data=b"signed-part", method="PUT"), timeout=30
            ) as response:
                self.record(
                    "signed_endpoint_http_access",
                    http_status=response.status,
                    etag_readable=bool(response.headers.get("ETag")),
                )
        except Exception as error:
            self.record("signed_endpoint_http_access", "BLOCKED", **self.observe_error(error))
        try:
            request = Request(
                target,
                method="OPTIONS",
                headers={
                    "Origin": self.origin,
                    "Access-Control-Request-Method": "PUT",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            with urlopen(request, timeout=30) as response:
                facts = cors_preflight_evidence(response.status, response.headers, self.origin)
                self.record("cors_preflight", **facts)
        except Exception as error:
            self.record("cors_preflight", "BLOCKED", **self.observe_error(error))
        self.record(
            "browser_access",
            "UNKNOWN",
            note="Requires separate real-browser PUT before scoped cleanup",
        )
        if browser_script:
            result = subprocess.run(
                ["node", str(browser_script)],
                input=json.dumps({"url": target, "origin": self.origin}),
                text=True,
                capture_output=True,
                timeout=60,
            )
            if result.returncode:
                self.record("browser_access", "BLOCKED", error_class="BrowserLauncherFailed")
            else:
                self.report["checks"]["browser_access"] = json.loads(result.stdout)

    def cleanup(self) -> None:
        """Best-effort every item; PASS requires complete independent final inventories.

        This establishes only a bounded observation after locally joined calls,
        never a permanent late-IO guarantee. Unknown calls retain BLOCKED status.
        """
        stages = {}

        def scan(name, method, fields):
            stage = {"status": "PASS", "failures": [], "discovered": 0}
            stages[name] = stage
            items = {field: [] for field in fields}
            try:
                for page in self.client.get_paginator(method).paginate(
                    Bucket=self.bucket, Prefix=self.prefix
                ):
                    for field in fields:
                        for item in page.get(field, []):
                            try:
                                self.require_scoped_key(item["Key"])
                                items[field].append(item)
                                stage["discovered"] += 1
                            except Exception as error:
                                stage["status"] = "BLOCKED"
                                stage["failures"].append(self.observe_error(error))
            except Exception as error:
                stage["status"] = "BLOCKED"
                stage["failures"].append(self.observe_error(error))
            return items

        def clean_items(name, items, action):
            stage = {"status": "PASS", "attempted": 0, "succeeded": 0, "failures": []}
            stages[name] = stage
            for item in items:
                stage["attempted"] += 1
                try:
                    self.require_scoped_key(item["Key"])
                    action(item)
                    stage["succeeded"] += 1
                except ClientError as error:
                    if (
                        name.startswith("abort_")
                        and error.response["Error"]["Code"] == "NoSuchUpload"
                    ):
                        stage["succeeded"] += 1
                    else:
                        stage["status"] = "BLOCKED"
                        stage["failures"].append(self.observe_error(error))
                except Exception as error:
                    stage["status"] = "BLOCKED"
                    stage["failures"].append(self.observe_error(error))

        def abort(item):
            self.client.abort_multipart_upload(
                Bucket=self.bucket, Key=item["Key"], UploadId=item["UploadId"]
            )

        clean_items(
            "abort_registered", [{"Key": k, "UploadId": u} for k, u in sorted(self.uploads)], abort
        )
        found = scan("discover_mpu", "list_multipart_uploads", ("Uploads",))
        clean_items("abort_discovered", found["Uploads"], abort)
        found = scan("discover_objects", "list_objects_v2", ("Contents",))
        keys = self.keys | {item["Key"] for item in found["Contents"]}
        clean_items(
            "delete_objects",
            [{"Key": k} for k in sorted(keys)],
            lambda item: self.client.delete_object(Bucket=self.bucket, Key=item["Key"]),
        )
        # Deleting current objects may create markers; enumerate versions afterwards.
        found = scan("discover_versions", "list_object_versions", ("Versions", "DeleteMarkers"))
        for field in ("Versions", "DeleteMarkers"):
            clean_items(
                "delete_" + field.lower(),
                found[field],
                lambda item: self.client.delete_object(
                    Bucket=self.bucket, Key=item["Key"], VersionId=item["VersionId"]
                ),
            )
        final_mpu = scan("verify_mpu", "list_multipart_uploads", ("Uploads",))
        final_objects = scan("verify_objects", "list_objects_v2", ("Contents",))
        final_versions = scan(
            "verify_versions", "list_object_versions", ("Versions", "DeleteMarkers")
        )
        counts = {
            "remaining_uploads": len(final_mpu["Uploads"])
            if stages["verify_mpu"]["status"] == "PASS"
            else None,
            "remaining_objects": len(final_objects["Contents"])
            if stages["verify_objects"]["status"] == "PASS"
            else None,
            "remaining_versions": len(final_versions["Versions"])
            if stages["verify_versions"]["status"] == "PASS"
            else None,
            "remaining_delete_markers": len(final_versions["DeleteMarkers"])
            if stages["verify_versions"]["status"] == "PASS"
            else None,
        }
        passed = (
            all(s["status"] == "PASS" for s in stages.values())
            and all(v == 0 for v in counts.values())
            and not self.unsettled_io
        )
        self.record(
            "cleanup",
            "PASS" if passed else "BLOCKED",
            stages=stages,
            **counts,
            unsettled_io=self.unsettled_io,
            observation="bounded final inventories; not a permanent late-IO guarantee",
        )

    def run(self, browser_script: Path | None = None) -> None:
        for operation in (
            self.configuration,
            self.basic,
            self.invalid_completion,
            self.orphan_discovery,
            self.abort_and_races,
            self.abort_inflight_part,
            self.checksums,
        ):
            try:
                operation()
            except Exception as error:
                self.record(operation.__name__, "BLOCKED", **self.observe_error(error))
        try:
            self.signed_transport(browser_script)
        except Exception as error:
            self.record("signed_transport", "BLOCKED", **self.observe_error(error))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-isolated", action="store_true", required=True)
    parser.add_argument("--origin", default="http://localhost:3000")
    parser.add_argument("--browser-script", type=Path)
    args = parser.parse_args()
    settings = json.load(sys.stdin)
    probe = Qualification(settings, args.origin)
    try:
        probe.run(args.browser_script)
    finally:
        probe.cleanup()
    print(json.dumps(probe.report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
