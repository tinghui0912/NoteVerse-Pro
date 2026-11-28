"""S3 wire operations, exact upload signatures and sanitized provider errors."""

from collections.abc import Iterator
from contextlib import contextmanager

import boto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    HTTPClientError,
    ConnectionError,
    ResponseStreamingError,
    IncompleteReadError,
)

from app.platform.config.storage import ObjectStorageConfig
from app.storage.base import (
    DirectUploadTarget,
    ObjectWriteResult,
    ObjectMetadata,
    UploadedPart,
    MultipartUploadResult,
    ObjectNotFoundError,
    ObjectStorageUnavailableError,
    ObjectStorageOperationFailedError,
)


@contextmanager
def provider_operation() -> Iterator[None]:
    """Unavailable mutations retain an unknown outcome and require caller recovery."""
    try:
        yield
    except ClientError as error:
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        code = error.response.get("Error", {}).get("Code", "")
        if status == 404 and code in {"404", "NoSuchKey", "NotFound", "NoSuchUpload"}:
            raise ObjectNotFoundError("Object or upload handle does not exist") from None
        if (
            status in {0, 408, 429}
            or status >= 500
            or code in {"InternalError", "ServiceUnavailable", "SlowDown", "RequestTimeout"}
        ):
            raise ObjectStorageUnavailableError("Object storage outcome unavailable") from None
        raise ObjectStorageOperationFailedError("Object storage operation rejected") from None
    except (HTTPClientError, ConnectionError, ResponseStreamingError, IncompleteReadError, OSError):
        raise ObjectStorageUnavailableError("Object storage outcome unavailable") from None
    except BotoCoreError:
        raise ObjectStorageOperationFailedError(
            "Object storage configuration or request invalid"
        ) from None


def _check_response(response: dict) -> None:
    if response.get("Error"):
        raise ClientError(response, "ObjectStorage")


def _checksum(response: dict) -> dict:
    for algorithm in ("SHA256", "SHA1", "CRC64NVME", "CRC32C", "CRC32"):
        value = response.get("Checksum" + algorithm)
        if value:
            return dict(
                checksum_algorithm=algorithm,
                checksum=value,
                checksum_type=response.get("ChecksumType"),
            )
    return {}


def _positive(value: int, name: str) -> None:
    if type(value) is not int or value <= 0:
        raise ValueError(f"{name} must be a positive integer")


class S3CompatibleObjectStorage:
    """Provider client lifecycle and synchronous S3 capabilities."""

    def __init__(self, config: ObjectStorageConfig) -> None:
        self.config = config
        self.bucket = self.config.S3_BUCKET or ""
        self.endpoint_url = self.config.S3_ENDPOINT_URL or ""
        self.region = self.config.S3_REGION
        self._client = None
        self._signing_client = None
        self._mutation_client = None

    @property
    def client(self):
        if self._client is None:
            self._client = self._make_client(self.endpoint_url)
        return self._client

    @property
    def mutation_client(self):
        """Ambiguous side effects are recovered by their persistent operation owner."""
        if self._mutation_client is None:
            self._mutation_client = self._make_client(self.endpoint_url, total_max_attempts=1)
        return self._mutation_client

    def _make_client(self, endpoint_url: str, *, total_max_attempts: int | None = None):
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=self.region,
            aws_access_key_id=self.config.S3_ACCESS_KEY_ID,
            aws_secret_access_key=self.config.S3_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                connect_timeout=self.config.S3_CONNECT_TIMEOUT_SECONDS,
                read_timeout=self.config.S3_READ_TIMEOUT_SECONDS,
                retries={
                    "mode": "standard",
                    "total_max_attempts": self.config.S3_MAX_ATTEMPTS
                    if total_max_attempts is None
                    else total_max_attempts,
                },
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                s3={
                    "addressing_style": "path" if self.config.S3_FORCE_PATH_STYLE else "virtual",
                    "payload_signing_enabled": False,
                },
            ),
        )

    @property
    def signing_client(self):
        if not self.config.S3_SIGNED_ENDPOINT_URL:
            return self.client
        if self._signing_client is None:
            self._signing_client = self._make_client(self.config.S3_SIGNED_ENDPOINT_URL)
        return self._signing_client

    def put_bytes(
        self, *, key: str, content: bytes, content_type: str | None = None
    ) -> ObjectWriteResult:
        key = self._normalize_key(key)
        with provider_operation():
            self.mutation_client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=content,
                **({"ContentType": content_type} if content_type else {}),
            )
        return ObjectWriteResult(key, len(content))

    def exists(self, key: str) -> bool:
        try:
            self.object_metadata(key)
            return True
        except ObjectNotFoundError:
            return False

    def read_bytes(self, key: str) -> bytes:
        return b"".join(self.iter_bytes(key))

    def object_metadata(self, key: str) -> ObjectMetadata:
        key = self._normalize_key(key)
        with provider_operation():
            response = self.client.head_object(Bucket=self.bucket, Key=key, ChecksumMode="ENABLED")
            return ObjectMetadata(
                size_bytes=int(response["ContentLength"]),
                content_type=response.get("ContentType"),
                etag=response.get("ETag"),
                **_checksum(response),
            )

    def generate_put_upload_url(
        self, key: str, *, content_type: str, content_length: int, expires_in: int | None = None
    ) -> DirectUploadTarget:
        return self._upload_target(
            "put_object",
            key,
            content_length,
            expires_in,
            {"ContentType": content_type},
            {"content-type": content_type},
        )

    def _upload_target(
        self,
        method: str,
        key: str,
        length: int,
        ttl: int | None,
        params: dict,
        headers: dict[str, str],
    ) -> DirectUploadTarget:
        _positive(length, "content_length")
        ttl = self.config.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS if ttl is None else ttl
        _positive(ttl, "expires_in")
        key = self._normalize_key(key)
        with provider_operation():
            url = self.signing_client.generate_presigned_url(
                ClientMethod=method,
                Params={"Bucket": self.bucket, "Key": key, "ContentLength": length, **params},
                ExpiresIn=ttl,
                HttpMethod="PUT",
            )
        return DirectUploadTarget(url, "PUT", {**headers, "content-length": str(length)})

    def create_multipart_upload(self, key: str, *, content_type: str) -> str:
        key = self._normalize_key(key)
        with provider_operation():
            response = self.mutation_client.create_multipart_upload(
                Bucket=self.bucket, Key=key, ContentType=content_type
            )
            if not response.get("UploadId"):
                raise ObjectStorageOperationFailedError("Provider omitted upload handle")
            return response["UploadId"]

    def generate_part_upload_url(
        self,
        key: str,
        upload_id: str,
        part_number: int,
        *,
        content_length: int,
        expires_in: int | None = None,
    ) -> DirectUploadTarget:
        _positive(part_number, "part_number")
        if part_number > 10000 or not upload_id:
            raise ValueError("Invalid multipart identity")
        return self._upload_target(
            "upload_part",
            key,
            content_length,
            expires_in,
            {"UploadId": upload_id, "PartNumber": part_number},
            {},
        )

    def list_multipart_uploads(self, key: str) -> tuple[str, ...]:
        key = self._normalize_key(key)
        handles: list[str] = []
        marker: dict[str, str] = {}
        with provider_operation():
            while True:
                response = self.client.list_multipart_uploads(
                    Bucket=self.bucket, Prefix=key, **marker
                )
                handles.extend(
                    item["UploadId"]
                    for item in response.get("Uploads", [])
                    if item.get("Key") == key
                )
                if not response.get("IsTruncated"):
                    return tuple(handles)
                following = {
                    "KeyMarker": response["NextKeyMarker"],
                    "UploadIdMarker": response["NextUploadIdMarker"],
                }
                if following == marker:
                    raise ObjectStorageOperationFailedError(
                        "Invalid multipart discovery pagination"
                    )
                marker = following

    def list_uploaded_parts(self, key: str, upload_id: str) -> tuple[UploadedPart, ...]:
        key = self._normalize_key(key)
        parts: list[UploadedPart] = []
        marker = 0
        with provider_operation():
            while True:
                response = self.client.list_parts(
                    Bucket=self.bucket, Key=key, UploadId=upload_id, PartNumberMarker=marker
                )
                parts.extend(
                    UploadedPart(p["PartNumber"], p["ETag"], p["Size"])
                    for p in response.get("Parts", [])
                )
                if not response.get("IsTruncated"):
                    return tuple(parts)
                following = int(response.get("NextPartNumberMarker", 0))
                if following <= marker:
                    raise ObjectStorageOperationFailedError("Invalid provider pagination")
                marker = following

    def complete_multipart_upload(
        self, key: str, upload_id: str, parts: tuple[UploadedPart, ...]
    ) -> MultipartUploadResult:
        key = self._normalize_key(key)
        numbers = [p.part_number for p in parts]
        if not parts or numbers != sorted(set(numbers)) or numbers[0] <= 0 or numbers[-1] > 10000:
            raise ValueError("Parts must have unique increasing numbers")
        with provider_operation():
            response = self.mutation_client.complete_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={
                    "Parts": [{"PartNumber": p.part_number, "ETag": p.etag} for p in parts]
                },
            )
            _check_response(response)
            return MultipartUploadResult(etag=response.get("ETag"), **_checksum(response))

    def abort_multipart_upload(self, key: str, upload_id: str) -> None:
        key = self._normalize_key(key)
        try:
            with provider_operation():
                self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=upload_id)
        except ObjectNotFoundError:
            return

    def iter_bytes(
        self,
        key: str,
        *,
        chunk_size: int = 1024 * 1024,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]:
        key = self._normalize_key(key)
        _positive(chunk_size, "chunk_size")
        params = {}
        if start is not None or end is not None:
            params["Range"] = f"bytes={start or 0}-{'' if end is None else end}"
        with provider_operation():
            response = self.client.get_object(Bucket=self.bucket, Key=key, **params)
            body = response["Body"]
            try:
                yield from body.iter_chunks(chunk_size=chunk_size)
            finally:
                body.close()

    def delete(self, key: str) -> None:
        key = self._normalize_key(key)
        try:
            with provider_operation():
                self.client.delete_object(Bucket=self.bucket, Key=key)
        except ObjectNotFoundError:
            return

    def copy(self, source_key: str, target_key: str) -> None:
        source_key, target_key = self._normalize_key(source_key), self._normalize_key(target_key)
        with provider_operation():
            response = self.mutation_client.copy_object(
                CopySource={"Bucket": self.bucket, "Key": source_key},
                Bucket=self.bucket,
                Key=target_key,
            )
            if response and response.get("Error"):
                _check_response(response)

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        expires_seconds: int | None = None,
    ) -> str:
        key = self._normalize_key(key)
        params = {"Bucket": self.bucket, "Key": key}
        if filename:
            params["ResponseContentDisposition"] = (
                f'attachment; filename="{filename.replace(chr(34), "")}"'
            )
        if content_type:
            params["ResponseContentType"] = content_type
        ttl = (
            expires_seconds
            if expires_seconds is not None
            else self.config.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS
        )
        _positive(ttl, "expires_seconds")
        with provider_operation():
            return self.signing_client.generate_presigned_url(
                ClientMethod="get_object", Params=params, ExpiresIn=ttl
            )

    @staticmethod
    def _normalize_key(key: str) -> str:
        normalized = key.replace("\\", "/").strip("/")
        if not normalized or any(part in {".", ".."} for part in normalized.split("/")):
            raise ValueError("Invalid storage key")
        return normalized
