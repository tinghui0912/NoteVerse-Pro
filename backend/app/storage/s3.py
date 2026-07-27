"""S3-compatible object storage implementation."""

from __future__ import annotations

import os
from collections.abc import Iterator

from app.core.config import settings
from app.storage.base import StoredFile


class S3CompatibleStorage:
    """Object storage adapter for AWS S3-compatible APIs."""

    backend_name = "s3"
    score_prefix = "scores"
    blob_prefix = "blobs"
    avatar_prefix = "avatars"
    cache_prefix = "storage-cache"

    def __init__(self) -> None:
        self.bucket = settings.S3_BUCKET or ""
        self.endpoint_url = settings.S3_ENDPOINT_URL or ""
        self.region = settings.S3_REGION
        self.public_base_url = settings.S3_PUBLIC_BASE_URL
        self._client = None

    @property
    def client(self):
        """Create the S3 client lazily so local mode does not require boto3."""

        if self._client is not None:
            return self._client

        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise RuntimeError(
                "boto3 is required when FILE_STORAGE_BACKEND=s3. "
                "Install backend requirements before enabling S3 storage."
            ) from exc

        addressing_style = "path" if settings.S3_FORCE_PATH_STYLE else "virtual"
        self._client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
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
        return self._client

    def put_bytes(
        self,
        *,
        key: str,
        content: bytes,
        content_type: str | None = None,
    ) -> StoredFile:
        normalized_key = self._normalize_key(key)
        kwargs = {
            "Bucket": self.bucket,
            "Key": normalized_key,
            "Body": content,
        }
        if content_type:
            kwargs["ContentType"] = content_type
        self.client.put_object(**kwargs)
        return self._stored_file(normalized_key, size_bytes=len(content))

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
            return response["Body"].read()
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
            range_start = "" if start is None else str(start)
            range_end = "" if end is None else str(end)
            kwargs["Range"] = f"bytes={range_start}-{range_end}"
        try:
            response = self.client.get_object(**kwargs)
            yield from response["Body"].iter_chunks(chunk_size=chunk_size)
        except Exception as exc:
            if self._is_not_found_error(exc):
                raise FileNotFoundError(normalized_key) from exc
            raise

    def delete(self, key: str) -> bool:
        normalized_key = self._normalize_key(key)
        existed = self.exists(normalized_key)
        self.client.delete_object(Bucket=self.bucket, Key=normalized_key)
        return existed

    def local_path(self, key: str) -> str:
        normalized_key = self._normalize_key(key)
        return os.path.abspath(
            os.path.join(settings.WORK_ROOT, self.cache_prefix, normalized_key)
        )

    def public_url(self, key: str) -> str:
        normalized_key = self._normalize_key(key)
        if self.public_base_url:
            return f"{self.public_base_url.rstrip('/')}/{normalized_key}"
        if self.endpoint_url:
            endpoint = self.endpoint_url.replace("https://", "").replace("http://", "")
            return f"https://{self.bucket}.{endpoint}/{normalized_key}"
        return self.presign_get(normalized_key)

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str | None:
        return self.presign_get(
            key,
            filename=filename,
            content_type=content_type,
        )

    def presign_get(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str:
        normalized_key = self._normalize_key(key)
        params = {"Bucket": self.bucket, "Key": normalized_key}
        if filename:
            params["ResponseContentDisposition"] = (
                f'attachment; filename="{filename.replace(chr(34), "")}"'
            )
        if content_type:
            params["ResponseContentType"] = content_type
        return self.client.generate_presigned_url(
            ClientMethod="get_object",
            Params=params,
            ExpiresIn=settings.S3_PRESIGN_EXPIRE_SECONDS,
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

    def save_blob(
        self,
        *,
        content: bytes,
        sha256: str,
        extension: str,
        content_type: str | None = None,
    ) -> StoredFile:
        key = f"{self.blob_prefix}/{sha256[:2]}/{sha256}{extension}"
        if self.exists(key):
            return self._stored_file(key, size_bytes=len(content))
        return self.put_bytes(
            key=key,
            content=content,
            content_type=content_type,
        )

    def save_avatar(
        self,
        *,
        content: bytes,
        filename: str,
    ) -> StoredFile:
        return self.put_bytes(
            key=f"{self.avatar_prefix}/{filename}",
            content=content,
            content_type="image/jpeg",
        )

    def avatar_url(self, filename: str) -> str:
        return self.public_url(f"{self.avatar_prefix}/{filename}")

    def delete_avatar(self, filename: str) -> bool:
        return self.delete(f"{self.avatar_prefix}/{filename}")

    def _stored_file(self, key: str, *, size_bytes: int) -> StoredFile:
        normalized_key = self._normalize_key(key)
        return StoredFile(
            storage_key=normalized_key,
            filename=os.path.basename(normalized_key),
            path=normalized_key,
            size_bytes=size_bytes,
            public_url=self.public_url(normalized_key),
        )

    @staticmethod
    def _normalize_key(key: str) -> str:
        normalized = key.replace("\\", "/").strip("/")
        if not normalized or normalized.startswith("../") or "/../" in normalized:
            raise ValueError(f"Invalid storage key: {key}")
        return normalized

    @staticmethod
    def _is_not_found_error(exc: Exception) -> bool:
        response = getattr(exc, "response", None)
        if not isinstance(response, dict):
            return False
        error = response.get("Error") or {}
        code = str(error.get("Code") or "")
        return code in {"404", "NoSuchKey", "NotFound", "NoSuchBucket"}
