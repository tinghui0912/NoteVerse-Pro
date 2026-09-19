"""Publish and verify ByteDance ONNX model asset on Private Aliyun OSS Bucket.

Verifies that the canonical content-addressed model object exists on the private
`noteverse-model-assets` bucket and matches the exact byte size (98,691,493) and
SHA256 (6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5).

Uses the official alibabacloud-oss-v2 SDK. All boto3 / botocore / AWS S3 dependencies
have been removed from this domain.

By default, runs in VERIFY ONLY mode. When --publish is passed, uploads the model
only if the object does not already exist. If an existing remote object has an
unexpected size or SHA256, verification aborts immediately without overwriting.

Checks and enforces:
1. Bucket ACL is private (public-read / public-read-write forbidden).
2. Bucket CORS contains no wildcards (*), and allows GET/HEAD for localhost:3000
   and staging.johnabc.ccwu.cc.
3. Remote object byte size and SHA256 match the exact canonical anchor.

Outputs a structured JSON report to backend/research/reports/bytedance_model_asset_verification.json.
(Excludes all presigned tokens and secrets).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import alibabacloud_oss_v2 as oss

EXPECTED_BYTE_SIZE = 98_691_493
EXPECTED_SHA256 = "6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5"
ASSET_ID = "bytedance-piano-transcription-note-model"
ASSET_VERSION = "CRNN_note_F1_0.9677_pedal_F1_0.9186"

CANONICAL_KEY = (
    f"models/bytedance/piano-note/{EXPECTED_SHA256}/model.onnx"
)

REQUIRED_CORS_ORIGINS = {
    "http://localhost:3000",
    "https://staging.johnabc.ccwu.cc",
}


def load_env_defaults(backend_root: Path) -> None:
    """Load default credentials and configs from .env.docker if not present in env."""
    for env_name in [".env.docker", ".env"]:
        env_path = backend_root / env_name
        if env_path.exists():
            try:
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip())
            except Exception:
                pass


def compute_file_sha256_and_size(path: Path | str) -> tuple[str, int]:
    hasher = hashlib.sha256()
    total_size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
            total_size += len(chunk)
    return hasher.hexdigest(), total_size


def get_oss_client(region: str, ak: str, sk: str) -> oss.Client:
    cfg = oss.config.load_default()
    cfg.credentials_provider = oss.credentials.StaticCredentialsProvider(ak, sk)
    cfg.region = region
    return oss.Client(cfg)


def verify_bucket_security_and_cors(client: oss.Client, bucket: str) -> tuple[str, list[str]]:
    """Verify bucket ACL is private and CORS configuration has no wildcards."""
    print(f"[INFO] Verifying bucket ACL for '{bucket}'...")
    acl_result = client.get_bucket_acl(oss.models.GetBucketAclRequest(bucket=bucket))
    bucket_acl = str(acl_result.acl or "").lower()
    print(f"[INFO] Bucket ACL: {bucket_acl}")
    if bucket_acl != "private":
        print(f"[ERROR] Security violation: Bucket ACL is '{bucket_acl}', expected 'private'!")
        sys.exit(1)

    print(f"[INFO] Verifying bucket CORS for '{bucket}'...")
    cors_result = client.get_bucket_cors(oss.models.GetBucketCorsRequest(bucket=bucket))
    cors_rules = (
        cors_result.cors_configuration.cors_rules
        if cors_result.cors_configuration and cors_result.cors_configuration.cors_rules
        else []
    )

    all_allowed_origins: set[str] = set()
    all_allowed_methods: set[str] = set()

    for idx, rule in enumerate(cors_rules):
        origins = rule.allowed_origins or []
        methods = rule.allowed_methods or []
        for origin in origins:
            if origin == "*":
                print(f"[ERROR] Security violation: CORS rule {idx} allows wildcard origin '*'!")
                sys.exit(1)
            all_allowed_origins.add(origin)
        for method in methods:
            all_allowed_methods.add(method.upper())

    missing_origins = REQUIRED_CORS_ORIGINS - all_allowed_origins
    if missing_origins:
        print(f"[ERROR] CORS missing required origins: {missing_origins}")
        sys.exit(1)

    if "GET" not in all_allowed_methods or "HEAD" not in all_allowed_methods:
        print(f"[ERROR] CORS missing required methods GET/HEAD: {all_allowed_methods}")
        sys.exit(1)

    print(f"[SUCCESS] Bucket ACL is private and CORS origins verified: {sorted(all_allowed_origins)}")
    return bucket_acl, sorted(all_allowed_origins)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify or publish ByteDance model asset on OSS.")
    parser.add_argument(
        "--publish",
        action="store_true",
        default=False,
        help="Allow uploading local model if remote object is absent (default: verify only).",
    )
    args = parser.parse_args()

    backend_root = Path(__file__).resolve().parent.parent
    load_env_defaults(backend_root)

    local_model_path = (
        backend_root
        / "data"
        / "work"
        / "bytedance_browser_runtime_feasibility"
        / "bytedance_note_model_fixed_anchor.onnx"
    )

    local_model_verified = False
    if local_model_path.exists():
        print(f"[INFO] Verifying local model file: {local_model_path}")
        local_sha, local_size = compute_file_sha256_and_size(local_model_path)
        print(f"[INFO] Local size: {local_size} (expected: {EXPECTED_BYTE_SIZE})")
        print(f"[INFO] Local sha256: {local_sha}")
        if local_size != EXPECTED_BYTE_SIZE or local_sha != EXPECTED_SHA256:
            print("[ERROR] Local file does not match expected size/sha256!")
            sys.exit(1)
        local_model_verified = True
    elif args.publish:
        print(f"[ERROR] Local model file not found at: {local_model_path}; cannot publish.")
        sys.exit(1)

    bucket = os.environ.get("ALIYUN_OSS_MODEL_BUCKET", "noteverse-model-assets")
    region = os.environ.get("ALIYUN_OSS_MODEL_REGION", "cn-shenzhen")
    ak = os.environ.get("OSS_ACCESS_KEY_ID") or os.environ.get("S3_ACCESS_KEY_ID", "")
    sk = os.environ.get("OSS_ACCESS_KEY_SECRET") or os.environ.get("S3_SECRET_ACCESS_KEY", "")

    if not ak or not sk:
        print("[ERROR] OSS/S3 access key credentials must be set in environment.")
        sys.exit(1)

    client = get_oss_client(region, ak, sk)

    # 1. Bucket ACL & CORS verification
    bucket_acl, allowed_origins = verify_bucket_security_and_cors(client, bucket)

    # 2. Check if canonical object exists
    print(f"[INFO] Checking OSS bucket '{bucket}' for key: {CANONICAL_KEY}")
    remote_exists = False
    try:
        head = client.head_object(oss.models.HeadObjectRequest(bucket=bucket, key=CANONICAL_KEY))
        remote_content_length = int(head.content_length or 0)
        print(f"[INFO] Remote object exists with ContentLength: {remote_content_length}")
        if remote_content_length != EXPECTED_BYTE_SIZE:
            print(
                f"[ERROR] Remote object size mismatch: {remote_content_length} != {EXPECTED_BYTE_SIZE}!"
            )
            sys.exit(1)
        remote_exists = True
    except Exception as e:
        print(f"[INFO] Remote object head query: {e}")

    if not remote_exists:
        if not args.publish:
            print("[ERROR] Remote object does not exist and --publish flag was not provided (Verify Only mode).")
            sys.exit(1)

        print(f"[INFO] Uploading local model ({EXPECTED_BYTE_SIZE} bytes) to oss://{bucket}/{CANONICAL_KEY}...")
        start_upload = time.time()
        with open(local_model_path, "rb") as f:
            client.put_object(
                oss.models.PutObjectRequest(
                    bucket=bucket,
                    key=CANONICAL_KEY,
                    body=f,
                    content_type="application/octet-stream",
                )
            )
        print(f"[INFO] Upload completed in {time.time() - start_upload:.2f}s")

    # 3. Stream remote object from OSS to verify byte-exact integrity and SHA256
    print(f"[INFO] Streaming remote object to verify exact size and SHA256...")
    stream_start = time.time()
    get_res = client.get_object(oss.models.GetObjectRequest(bucket=bucket, key=CANONICAL_KEY))
    remote_hasher = hashlib.sha256()
    remote_size = 0

    for chunk in get_res.body.iter_bytes():
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
        "bucketAcl": bucket_acl,
        "corsVerified": True,
        "corsAllowedOrigins": allowed_origins,
        "verifiedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "aliyun-oss-private-object",
        "streamVerificationDurationMs": duration_ms,
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"[INFO] Verification report written to: {report_path}")


if __name__ == "__main__":
    main()
