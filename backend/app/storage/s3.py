"""S3-compatible object storage implementation."""

from __future__ import annotations

import os

from app.core.config import settings
from app.storage.base import StoredFile


class S3CompatibleStorage:
    """Object storage adapter for AWS S3-compatible APIs."""

    backend_name = "s3"
    score_prefix = "scores"
    upload_prefix = "uploads"
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

    def save_score_upload(
        self,
        *,
        content: bytes,
        sha256: str,
        extension: str,
    ) -> StoredFile:
        existing = self.find_score_upload(sha256)
        if existing:
            return existing
        return self.put_bytes(
            key=f"{self.upload_prefix}/{sha256}{extension}",
            content=content,
        )

    def find_score_upload(self, sha256: str) -> StoredFile | None:
        prefix = self._normalize_key(f"{self.upload_prefix}/{sha256}")
        response = self.client.list_objects_v2(
            Bucket=self.bucket,
            Prefix=prefix,
            MaxKeys=1,
        )
        contents = response.get("Contents") or []
        if not contents:
            return None
        item = contents[0]
        return self._stored_file(
            str(item["Key"]),
            size_bytes=int(item.get("Size") or 0),
        )

    def resolve_score_uploads(self, file_ids: list[str]) -> list[str]:
        paths: list[str] = []
        for file_id in file_ids:
            stored = self.find_score_upload(file_id)
            if not stored:
                raise FileNotFoundError(file_id)
            paths.append(
                self.materialize_to_local(
                    stored.storage_key,
                    self.local_path(stored.storage_key),
                )
            )
        return paths

    def score_upload_path(self, filename: str) -> str:
        key = f"{self.upload_prefix}/{filename}"
        return self.materialize_to_local(key, self.local_path(key))

    def score_upload_exists(self, filename: str) -> bool:
        return self.exists(f"{self.upload_prefix}/{filename}")

    def delete_score_upload(self, filename: str) -> bool:
        return self.delete(f"{self.upload_prefix}/{filename}")

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
