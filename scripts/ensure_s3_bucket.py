"""Ensure an S3-compatible bucket exists.

This script is intended for deployment rehearsals and operator preflight
checks. It reads configuration from the environment and, optionally, one or
more dotenv-style files. It never prints credentials.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Iterable


REQUIRED_KEYS = (
    "S3_ENDPOINT_URL",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
)


def load_env_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"env file not found: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def require_env(keys: Iterable[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    missing: list[str] = []
    for key in keys:
        value = os.environ.get(key)
        if value:
            values[key] = value
        else:
            missing.append(key)
    if missing:
        raise RuntimeError(f"missing required S3 configuration: {', '.join(missing)}")
    return values


def is_not_found(exc: Exception) -> bool:
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error") or {}
    code = str(error.get("Code") or "")
    status = str((response.get("ResponseMetadata") or {}).get("HTTPStatusCode") or "")
    return code in {"404", "NoSuchBucket", "NotFound"} or status == "404"


def create_bucket(client, *, bucket: str, region: str) -> None:
    if region in {"", "auto", "us-east-1"}:
        client.create_bucket(Bucket=bucket)
        return
    client.create_bucket(
        Bucket=bucket,
        CreateBucketConfiguration={"LocationConstraint": region},
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file",
        action="append",
        type=Path,
        default=[],
        help="Dotenv file to load before reading S3 settings. Can be repeated.",
    )
    parser.add_argument(
        "--create",
        action="store_true",
        help="Create the bucket when it does not exist.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for env_file in args.env_file:
        load_env_file(env_file)

    values = require_env(REQUIRED_KEYS)

    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise RuntimeError(
            "boto3 is required. Install backend/requirements/storage.txt "
            "or run this script in a backend runtime environment."
        ) from exc

    force_path_style = os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() == "true"
    addressing_style = "path" if force_path_style else "virtual"
    client = boto3.client(
        "s3",
        endpoint_url=values["S3_ENDPOINT_URL"],
        region_name=values["S3_REGION"],
        aws_access_key_id=values["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=values["S3_SECRET_ACCESS_KEY"],
        config=Config(
            signature_version="s3v4",
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            s3={
                "addressing_style": addressing_style,
                "payload_signing_enabled": False,
            },
        ),
    )

    bucket = values["S3_BUCKET"]
    try:
        client.head_bucket(Bucket=bucket)
        print(f"S3 bucket exists: {bucket}")
        return 0
    except Exception as exc:
        if not is_not_found(exc):
            raise
        if not args.create:
            raise RuntimeError(
                f"S3 bucket does not exist: {bucket}. Re-run with --create to create it."
            ) from exc

    create_bucket(client, bucket=bucket, region=values["S3_REGION"])
    client.head_bucket(Bucket=bucket)
    print(f"S3 bucket created: {bucket}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
