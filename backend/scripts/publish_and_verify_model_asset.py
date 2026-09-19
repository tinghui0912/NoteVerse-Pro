"""Publish and verify ByteDance ONNX model asset on Private Aliyun OSS Bucket.

Verifies that the canonical content-addressed model object exists on the private
`noteverse-model-assets` bucket and matches the exact byte size (98,691,493) and
SHA256 (6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5).

Outputs a structured JSON report to backend/research/reports/bytedance_model_asset_verification.json.
(Note: Excludes all presigned tokens and secrets).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config

EXPECTED_BYTE_SIZE = 98_691_493
EXPECTED_SHA256 = "6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5"
ASSET_ID = "bytedance-piano-transcription-note-model"
ASSET_VERSION = "CRNN_note_F1_0.9677_pedal_F1_0.9186"

CANONICAL_KEY = (
    f"models/bytedance/piano-note/{EXPECTED_SHA256}/model.onnx"
)


def compute_file_sha256_and_size(path: Path | str) -> tuple[str, int]:
    hasher = hashlib.sha256()
    total_size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
            total_size += len(chunk)
    return hasher.hexdigest(), total_size


def get_s3_client(endpoint_url: str, region: str, ak: str, sk: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region,
        aws_access_key_id=ak,
        aws_secret_access_key=sk,
        config=Config(
            signature_version="s3v4",
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            s3={
                "addressing_style": "virtual",
                "payload_signing_enabled": False,
            },
        ),
    )


def main() -> None:
    backend_root = Path(__file__).resolve().parent.parent
    local_model_path = (
        backend_root
        / "data"
        / "work"
        / "bytedance_browser_runtime_feasibility"
        / "bytedance_note_model_fixed_anchor.onnx"
    )

    if not local_model_path.exists():
        print(f"[ERROR] Local model file not found at: {local_model_path}")
        sys.exit(1)

    print(f"[INFO] Verifying local model file: {local_model_path}")
    local_sha, local_size = compute_file_sha256_and_size(local_model_path)
    print(f"[INFO] Local size: {local_size} (expected: {EXPECTED_BYTE_SIZE})")
    print(f"[INFO] Local sha256: {local_sha}")

    if local_size != EXPECTED_BYTE_SIZE or local_sha != EXPECTED_SHA256:
        print("[ERROR] Local file does not match expected size/sha256!")
        sys.exit(1)

    bucket = os.environ.get("ALIYUN_OSS_MODEL_BUCKET", "noteverse-model-assets")
    region = os.environ.get("ALIYUN_OSS_MODEL_REGION", "cn-shenzhen")
    ak = os.environ.get("S3_ACCESS_KEY_ID", "")
    sk = os.environ.get("S3_SECRET_ACCESS_KEY", "")

    if not ak or not sk:
        print("[ERROR] S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables must be set.")
        sys.exit(1)

    client = get_s3_client(endpoint_url, region, ak, sk)

    # Check if canonical object exists
    print(f"[INFO] Checking OSS bucket '{bucket}' for key: {CANONICAL_KEY}")
    needs_upload = False
    try:
        head = client.head_object(Bucket=bucket, Key=CANONICAL_KEY)
        remote_content_length = int(head.get("ContentLength", 0))
        if remote_content_length != EXPECTED_BYTE_SIZE:
            print(f"[WARN] Remote size mismatch: {remote_content_length} != {EXPECTED_BYTE_SIZE}. Re-uploading...")
            needs_upload = True
        else:
            print(f"[INFO] Remote object exists with ContentLength: {remote_content_length}")
    except Exception as e:
        print(f"[INFO] Remote object not found or head error: {e}. Uploading...")
        needs_upload = True

    if needs_upload:
        print(f"[INFO] Uploading local model ({local_size} bytes) to s3://{bucket}/{CANONICAL_KEY}...")
        start_upload = time.time()
        with open(local_model_path, "rb") as f:
            client.put_object(
                Bucket=bucket,
                Key=CANONICAL_KEY,
                Body=f,
                ContentType="application/octet-stream",
            )
        print(f"[INFO] Upload completed in {time.time() - start_upload:.2f}s")

    # Stream remote object from OSS to verify byte-exact integrity
    print(f"[INFO] Streaming remote object to verify size and SHA256...")
    stream_start = time.time()
    response = client.get_object(Bucket=bucket, Key=CANONICAL_KEY)
    body = response["Body"]
    remote_hasher = hashlib.sha256()
    remote_size = 0

    while True:
        chunk = body.read(1024 * 1024)
        if not chunk:
            break
        remote_hasher.update(chunk)
        remote_size += len(chunk)

    duration_ms = int((time.time() - stream_start) * 1000)
    remote_sha = remote_hasher.hexdigest()
    print(f"[INFO] Stream verification completed in {duration_ms}ms")
    print(f"[INFO] Remote size: {remote_size}")
    print(f"[INFO] Remote sha256: {remote_sha}")

    matches = (remote_size == EXPECTED_BYTE_SIZE) and (remote_sha == EXPECTED_SHA256)
    if not matches:
        print(f"[ERROR] Remote object verification failed! Size: {remote_size}, SHA: {remote_sha}")
        sys.exit(1)

    print(f"[SUCCESS] Remote object perfectly matches expected identity!")

    report_dir = backend_root / "research" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "bytedance_model_asset_verification.json"

    report = {
        "schemaVersion": 1,
        "assetId": ASSET_ID,
        "assetVersion": ASSET_VERSION,
        "bucket": bucket,
        "region": region,
        "objectKey": CANONICAL_KEY,
        "mediaType": "application/octet-stream",
        "expectedByteSize": EXPECTED_BYTE_SIZE,
        "actualByteSize": remote_size,
        "expectedSha256": EXPECTED_SHA256,
        "actualSha256": remote_sha,
        "matches": matches,
        "verifiedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "aliyun-oss-private-object",
        "streamVerificationDurationMs": duration_ms,
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"[INFO] Verification report written to: {report_path}")


if __name__ == "__main__":
    main()
