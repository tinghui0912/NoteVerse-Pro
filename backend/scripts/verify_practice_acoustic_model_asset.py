"""Verify or publish the exact Practice acoustic asset without conversion or overwrite.

Run in the backend Docker image with its existing OSS environment. Reports omit
credentials, signed URLs and SDK exception bodies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import alibabacloud_oss_v2 as oss

from app.modules.model_assets.generated.practice_acoustic_contract import (
    MODEL_ASSET,
    ANALYSIS_IDENTITY,
)


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


def verify_asset(publish: bool, report: Path, model: Path) -> dict:
    if report.exists():
        raise RuntimeError("APPEND_ONLY_REPORT_ALREADY_EXISTS")
    result = {
        "assetIdentity": ANALYSIS_IDENTITY["identityName"],
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "status": "ASSET_GATE_PENDING",
        "expectedBytes": MODEL_ASSET.byte_size,
        "expectedSha256": MODEL_ASSET.sha256,
        "objectKey": MODEL_ASSET.storage_key,
        "newNeuralInferenceCount": 0,
        "uploaded": False,
    }
    try:
        size, sha = digest_file(model)
        result["localBytes"], result["localSha256"] = size, sha
        if (size, sha) != (MODEL_ASSET.byte_size, MODEL_ASSET.sha256):
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
            head = client.head_object(
                oss.models.HeadObjectRequest(bucket=bucket, key=MODEL_ASSET.storage_key)
            )
            if int(head.content_length) != MODEL_ASSET.byte_size:
                raise RuntimeError("EXISTING_CONTENT_ADDRESSED_OBJECT_SIZE_MISMATCH")
        except Exception as wrapped:
            error = underlying(wrapped)
            if (
                not isinstance(error, oss.exceptions.ServiceError)
                or error.status_code != 404
                or error.code not in ("NoSuchKey", "NotFound")
            ):
                raise
            exists = False
        if not exists:
            if not publish:
                raise RuntimeError("EXACT_DELIVERY_OBJECT_NOT_PUBLISHED")
            with model.open("rb") as handle:
                client.put_object(
                    oss.models.PutObjectRequest(
                        bucket=bucket,
                        key=MODEL_ASSET.storage_key,
                        body=handle,
                        content_type=MODEL_ASSET.media_type,
                        forbid_overwrite=True,
                    )
                )
            result["uploaded"] = True
        remote = client.get_object(
            oss.models.GetObjectRequest(bucket=bucket, key=MODEL_ASSET.storage_key)
        )
        digest = hashlib.sha256()
        count = 0
        try:
            for chunk in remote.body.iter_bytes():
                count += len(chunk)
                if count > MODEL_ASSET.byte_size:
                    raise RuntimeError("REMOTE_MODEL_BYTE_LIMIT_EXCEEDED")
                digest.update(chunk)
        finally:
            remote.body.close()
        result["remoteBytes"], result["remoteSha256"] = count, digest.hexdigest()
        if (count, digest.hexdigest()) != (MODEL_ASSET.byte_size, MODEL_ASSET.sha256):
            raise RuntimeError("REMOTE_MODEL_IDENTITY_MISMATCH")
        result["status"] = "EXACT_VALIDATED_ASSET_DELIVERY_VERIFIED"
    except Exception as error:
        error = underlying(error)
        result["status"] = "EXACT_ASSET_DELIVERY_GATE_BLOCKED"
        result["failure"] = {
            "type": type(error).__name__,
            "code": getattr(error, "code", str(error) if isinstance(error, RuntimeError) else None),
            "httpStatus": getattr(error, "status_code", None),
        }
    result["completedAt"] = datetime.now(timezone.utc).isoformat()
    with report.open("x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    receipt = verify_asset(args.publish, args.report, args.model)
    print(json.dumps(receipt))
    raise SystemExit(0 if receipt["status"] == "EXACT_VALIDATED_ASSET_DELIVERY_VERIFIED" else 1)
