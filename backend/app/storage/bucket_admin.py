"""Provider client construction for explicit operator bucket administration."""

import boto3
from botocore.config import Config


def bucket_client(values: dict[str, str], *, force_path_style: bool):
    return boto3.client(
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
                "addressing_style": "path" if force_path_style else "virtual",
                "payload_signing_enabled": False,
            },
        ),
    )
