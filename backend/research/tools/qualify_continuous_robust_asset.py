"""Verify/publish the exact qualified Continuous model, never convert or overwrite it.

Run in the backend Docker image with its existing OSS environment. Reports omit
credentials, signed URLs and SDK exception bodies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import alibabacloud_oss_v2 as oss

SHA = "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3"
SIZE = 98_689_283
KEY = f"models/continuous/robust-browser-v1/{SHA}/model.onnx"
ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / "data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx"
REPORT = ROOT / "research/reports/continuous_microphone_asset_gate_2026-10-16.json"


def digest_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            count += len(chunk)
            digest.update(chunk)
    return count, digest.hexdigest()


def underlying(error: Exception) -> Exception:
    seen: set[int] = set()
    while isinstance(error, oss.exceptions.OperationError) and id(error) not in seen:
        seen.add(id(error))
        error = error.unwrap()
    return error


def qualify(publish: bool, report: Path) -> dict:
    if report.exists():
        raise RuntimeError("APPEND_ONLY_REPORT_ALREADY_EXISTS")
    result = {
        "phase": "PRACTICE_CONTINUOUS_MICROPHONE_RUNTIME_CLEAN_PROMOTION_DISABLED",
        "startingHead": "ae0408df03dfd19447b6191fbee7688cd0fd4edf",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "status": "ASSET_GATE_PENDING",
        "expectedBytes": SIZE, "expectedSha256": SHA, "objectKey": KEY,
        "priorArtifact": {"bytes": 98_691_493,
            "sha256": "6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5",
            "classification": "DISTINCT_HISTORICAL_ARTIFACT_NOT_ACCEPTED_BY_CONTINUOUS_RUNTIME"},
        "provenanceReport": "backend/research/reports/phase9g_d1r_robust_browser_candidate_identity_export_2026-10-12.json",
        "provenanceCommit": "4d8dbed42ece16b18f422ee834947027b1f84be0",
        "newNeuralInferenceCount": 0, "productionMicrophone": False,
        "uploaded": False,
    }
    try:
        size, sha = digest_file(LOCAL)
        result["localBytes"], result["localSha256"] = size, sha
        if (size, sha) != (SIZE, SHA):
            raise RuntimeError("EXACT_VALIDATED_ARTIFACT_UNAVAILABLE")
        ak = os.environ.get("OSS_ACCESS_KEY_ID") or os.environ.get("S3_ACCESS_KEY_ID")
        sk = os.environ.get("OSS_ACCESS_KEY_SECRET") or os.environ.get("S3_SECRET_ACCESS_KEY")
        if not ak or not sk:
            raise RuntimeError("ASSET_DELIVERY_CREDENTIALS_UNAVAILABLE")
        bucket = os.environ.get("ALIYUN_OSS_MODEL_BUCKET", "noteverse-model-assets")
        region = os.environ.get("ALIYUN_OSS_MODEL_REGION", "cn-shenzhen")
        result.update(bucket=bucket, region=region)
        cfg = oss.config.load_default()
        cfg.credentials_provider = oss.credentials.StaticCredentialsProvider(ak, sk)
        cfg.region = region
        cfg.connect_timeout = 10
        cfg.readwrite_timeout = 30
        cfg.retry_max_attempts = 1
        client = oss.Client(cfg)
        acl = client.get_bucket_acl(oss.models.GetBucketAclRequest(bucket=bucket))
        result["bucketAcl"] = str(acl.acl).lower()
        if result["bucketAcl"] != "private":
            raise RuntimeError("ASSET_BUCKET_NOT_PRIVATE")
        exists = True
        try:
            head = client.head_object(oss.models.HeadObjectRequest(bucket=bucket, key=KEY))
            if int(head.content_length) != SIZE:
                raise RuntimeError("EXISTING_CONTENT_ADDRESSED_OBJECT_SIZE_MISMATCH")
        except Exception as wrapped:
            error = underlying(wrapped)
            if not isinstance(error, oss.exceptions.ServiceError) or error.status_code != 404 or error.code not in ("NoSuchKey", "NotFound"):
                raise
            exists = False
        if not exists:
            if not publish:
                raise RuntimeError("EXACT_DELIVERY_OBJECT_NOT_PUBLISHED")
            with LOCAL.open("rb") as handle:
                client.put_object(oss.models.PutObjectRequest(bucket=bucket, key=KEY,
                    body=handle, content_type="application/octet-stream", forbid_overwrite=True))
            result["uploaded"] = True
        remote = client.get_object(oss.models.GetObjectRequest(bucket=bucket, key=KEY))
        digest = hashlib.sha256()
        count = 0
        try:
            for chunk in remote.body.iter_bytes():
                count += len(chunk)
                if count > SIZE:
                    raise RuntimeError("REMOTE_MODEL_BYTE_LIMIT_EXCEEDED")
                digest.update(chunk)
        finally:
            remote.body.close()
        result["remoteBytes"], result["remoteSha256"] = count, digest.hexdigest()
        if (count, digest.hexdigest()) != (SIZE, SHA):
            raise RuntimeError("REMOTE_MODEL_IDENTITY_MISMATCH")
        result["status"] = "EXACT_VALIDATED_ASSET_DELIVERY_VERIFIED"
    except Exception as error:
        error = underlying(error)
        result["status"] = "EXACT_ASSET_DELIVERY_GATE_BLOCKED"
        result["failure"] = {"type": type(error).__name__,
            "code": getattr(error, "code", str(error) if isinstance(error, RuntimeError) else None),
            "httpStatus": getattr(error, "status_code", None)}
    result["completedAt"] = datetime.now(timezone.utc).isoformat()
    with report.open("x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--report-name", default=REPORT.name)
    args = parser.parse_args()
    if not re.fullmatch(r"continuous_microphone_asset_gate[a-zA-Z0-9_.-]*\.json", args.report_name):
        raise SystemExit("INVALID_REPORT_NAME")
    receipt = qualify(args.publish, REPORT.parent / args.report_name)
    print(json.dumps(receipt))
    raise SystemExit(0 if receipt["status"] == "EXACT_VALIDATED_ASSET_DELIVERY_VERIFIED" else 1)
