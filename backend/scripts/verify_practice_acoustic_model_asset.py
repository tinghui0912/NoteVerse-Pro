"""Verify or publish the exact Practice acoustic asset without conversion or overwrite.

Run in the backend Docker image with its deployment object-store configuration. Reports omit
credentials, signed URLs and SDK exception bodies.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from app.storage.s3_compatible import S3CompatibleObjectStorage

from app.modules.model_assets.generated.practice_acoustic_model_asset import (
    MODEL_ASSET,
)


def digest_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            count += len(chunk)
            digest.update(chunk)
    return count, digest.hexdigest()


def verify_asset(publish: bool, report: Path, model: Path) -> dict:
    if report.exists():
        raise RuntimeError("APPEND_ONLY_REPORT_ALREADY_EXISTS")
    result = {
        "assetIdentity": f"{MODEL_ASSET.asset_id}@{MODEL_ASSET.asset_version}",
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
        storage = S3CompatibleObjectStorage()
        client, bucket = storage.client, storage.bucket
        result.update(bucket=bucket, region=storage.region)
        acl = client.get_bucket_acl(Bucket=bucket)
        owner = acl.get("Owner", {}).get("ID")
        grants = acl.get("Grants", [])
        private = bool(owner and grants) and all(
            grant.get("Grantee", {}).get("Type") == "CanonicalUser"
            and grant.get("Grantee", {}).get("ID") == owner
            for grant in grants
        )
        result["bucketAcl"] = "private" if private else "not-private"
        if not private:
            raise RuntimeError("ASSET_BUCKET_NOT_PRIVATE")
        exists = storage.exists(MODEL_ASSET.storage_key)
        if exists and storage.size_bytes(MODEL_ASSET.storage_key) != MODEL_ASSET.byte_size:
            raise RuntimeError("EXISTING_CONTENT_ADDRESSED_OBJECT_SIZE_MISMATCH")
        if not exists:
            if not publish:
                raise RuntimeError("EXACT_DELIVERY_OBJECT_NOT_PUBLISHED")
            with model.open("rb") as handle:
                client.put_object(
                    Bucket=bucket,
                    Key=MODEL_ASSET.storage_key,
                    Body=handle,
                    ContentType=MODEL_ASSET.media_type,
                    IfNoneMatch="*",
                )
            result["uploaded"] = True
        remote = client.get_object(Bucket=bucket, Key=MODEL_ASSET.storage_key)
        digest = hashlib.sha256()
        count = 0
        try:
            for chunk in remote["Body"].iter_chunks(chunk_size=1024 * 1024):
                count += len(chunk)
                if count > MODEL_ASSET.byte_size:
                    raise RuntimeError("REMOTE_MODEL_BYTE_LIMIT_EXCEEDED")
                digest.update(chunk)
        finally:
            remote["Body"].close()
        result["remoteBytes"], result["remoteSha256"] = count, digest.hexdigest()
        if (count, digest.hexdigest()) != (MODEL_ASSET.byte_size, MODEL_ASSET.sha256):
            raise RuntimeError("REMOTE_MODEL_IDENTITY_MISMATCH")
        result["status"] = "EXACT_VALIDATED_ASSET_DELIVERY_VERIFIED"
    except Exception as error:
        result["status"] = "EXACT_ASSET_DELIVERY_GATE_BLOCKED"
        response = getattr(error, "response", {})
        result["failure"] = {
            "type": type(error).__name__,
            "code": response.get("Error", {}).get(
                "Code", str(error) if isinstance(error, RuntimeError) else None
            ),
            "httpStatus": response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
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
