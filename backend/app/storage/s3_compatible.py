"""S3-compatible object storage implementation."""

from __future__ import annotations

import os
import boto3
from botocore.config import Config
from collections.abc import Iterator

from app.core.config import settings
from app.storage.base import DirectUploadTarget, StoredObject, StoredObjectMetadata


class S3CompatibleObjectStorage:
    """Object storage adapter for the S3-compatible wire protocol."""

    def __init__(self) -> None:
        self.bucket = settings.S3_BUCKET or ""
        self.endpoint_url = settings.S3_ENDPOINT_URL or ""
        self.region = settings.S3_REGION
        self._client = None
        self._signing_client = None

    @property
    def client(self):
        """Create the configured infrastructure client on first use."""

        if self._client is not None:
            return self._client

        return self._make_client(self.endpoint_url)

    def _make_client(self, endpoint_url: str):
        addressing_style = "path" if settings.S3_FORCE_PATH_STYLE else "virtual"
        client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=self.region,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
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
        if endpoint_url == self.endpoint_url:
            self._client = client
        return client

    @property
    def signing_client(self):
        if not settings.S3_SIGNED_ENDPOINT_URL:
            return self.client
        if self._signing_client is None:
            self._signing_client = self._make_client(settings.S3_SIGNED_ENDPOINT_URL)
        return self._signing_client

    def put_bytes(
        self,
        *,
        key: str,
        content: bytes,
        content_type: str | None = None,
    ) -> StoredObject:
        normalized_key = self._normalize_key(key)
        kwargs = {
            "Bucket": self.bucket,
            "Key": normalized_key,
            "Body": content,
        }
        if content_type:
            kwargs["ContentType"] = content_type
        self.client.put_object(**kwargs)
        return StoredObject(object_key=normalized_key, size_bytes=len(content))

    def exists(self, key: str) -> bool:
        normalized_key = self._normalize_key(key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=normalized_key)
            return True
        except Exception as exc:
            if self._is_not_found_error(exc):
                return False
            raise

    def read_bytes(self, key: str) -> bytes:
        normalized_key = self._normalize_key(key)
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=normalized_key)
            body = response["Body"]
            try:
                return body.read()
            finally:
                body.close()
        except Exception as exc:
            if self._is_not_found_error(exc):
                raise FileNotFoundError(normalized_key) from exc
            raise

    def size_bytes(self, key: str) -> int:
        normalized_key = self._normalize_key(key)
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=normalized_key)
            return int(response["ContentLength"])
        except Exception as exc:
            if self._is_not_found_error(exc):
                raise FileNotFoundError(normalized_key) from exc
            raise

    def object_metadata(self, key: str) -> StoredObjectMetadata:
        normalized_key = self._normalize_key(key)
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=normalized_key)
        except Exception as exc:
            if self._is_not_found_error(exc):
                raise FileNotFoundError(normalized_key) from exc
            raise
        metadata = response.get("Metadata") or {}
        checksum_sha256 = metadata.get("sha256")
        return StoredObjectMetadata(
            size_bytes=int(response["ContentLength"]),
            content_type=response.get("ContentType"),
            checksum_sha256=str(checksum_sha256) if checksum_sha256 else None,
        )

    def upload_url(
        self,
        key: str,
        *,
        content_type: str,
        checksum_sha256: str,
    ) -> DirectUploadTarget:
        normalized_key = self._normalize_key(key)
        headers = {
            "content-type": content_type,
            "x-amz-meta-sha256": checksum_sha256,
        }
        url = self.signing_client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": self.bucket,
                "Key": normalized_key,
                "ContentType": content_type,
                "Metadata": {"sha256": checksum_sha256},
            },
            ExpiresIn=settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS,
            HttpMethod="PUT",
        )
        return DirectUploadTarget(
            upload_url=url,
            upload_method="PUT",
            upload_headers=headers,
        )

    def iter_bytes(
        self,
        key: str,
        *,
        chunk_size: int = 1024 * 1024,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]:
        normalized_key = self._normalize_key(key)
        kwargs = {"Bucket": self.bucket, "Key": normalized_key}
        if start is not None or end is not None:
            range_start = str(start or 0)
            range_end = "" if end is None else str(end)
            kwargs["Range"] = f"bytes={range_start}-{range_end}"
        try:
            response = self.client.get_object(**kwargs)
            body = response["Body"]
            try:
                yield from body.iter_chunks(chunk_size=chunk_size)
            finally:
                body.close()
        except Exception as exc:
            if self._is_not_found_error(exc):
                raise FileNotFoundError(normalized_key) from exc
            raise

    def delete(self, key: str) -> bool:
        normalized_key = self._normalize_key(key)
        existed = self.exists(normalized_key)
        self.client.delete_object(Bucket=self.bucket, Key=normalized_key)
        return existed

    def copy(self, source_key: str, target_key: str) -> None:
        source_normalized = self._normalize_key(source_key)
        target_normalized = self._normalize_key(target_key)
        copy_source = {"Bucket": self.bucket, "Key": source_normalized}
        self.client.copy_object(CopySource=copy_source, Bucket=self.bucket, Key=target_normalized)

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        expires_seconds: int | None = None,
    ) -> str:
        normalized_key = self._normalize_key(key)
        params = {"Bucket": self.bucket, "Key": normalized_key}
        if filename:
            params["ResponseContentDisposition"] = (
                f'attachment; filename="{filename.replace(chr(34), "")}"'
            )
        if content_type:
            params["ResponseContentType"] = content_type
        return self.signing_client.generate_presigned_url(
            ClientMethod="get_object",
            Params=params,
            ExpiresIn=expires_seconds or settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS,
        )

    def materialize_to_local(self, key: str, target_path: str) -> str:
        normalized_key = self._normalize_key(key)
        target_abs = os.path.abspath(target_path)
        os.makedirs(os.path.dirname(target_abs), exist_ok=True)
        try:
            self.client.download_file(self.bucket, normalized_key, target_abs)
        except Exception as exc:
            if self._is_not_found_error(exc):
                raise FileNotFoundError(normalized_key) from exc
            raise
        return target_abs

    @staticmethod
    def _normalize_key(key: str) -> str:
        normalized = key.replace("\\", "/").strip("/")
        if not normalized or any(part in {".", ".."} for part in normalized.split("/")):
            raise ValueError(f"Invalid storage key: {key}")
        return normalized

    @staticmethod
    def _is_not_found_error(exc: Exception) -> bool:
        response = getattr(exc, "response", None)
        if not isinstance(response, dict):
            return False
        error = response.get("Error") or {}
        code = str(error.get("Code") or "")
        return code in {"404", "NoSuchKey", "NotFound"}
