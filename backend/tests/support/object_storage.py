"""Unit-test object namespace; integration tests exercise the concrete adapter separately."""

from collections.abc import Iterator
from uuid import uuid4
from hashlib import md5
from dataclasses import dataclass, field
from urllib.parse import quote
from app.core.config import settings
from app.storage.base import (
    DirectUploadTarget,
    ObjectWriteResult,
    ObjectMetadata,
    UploadedPart,
    MultipartUploadResult,
    ObjectNotFoundError,
    ObjectStorageOperationFailedError,
)


class InMemoryObjectStorage:
    def __init__(self, *, objects: dict[str, tuple[bytes, str | None]] | None = None):
        self.objects = objects if objects is not None else {}
        self.uploads: dict[str, _Multipart] = {}
        self.targets: dict[str, tuple[str, str | None, int, str | None, int | None]] = {}

    @staticmethod
    def _key(key: str) -> str:
        normalized = key.replace("\\", "/").strip("/")
        if not normalized or any(part in {".", ".."} for part in normalized.split("/")):
            raise ValueError("Invalid object key")
        return normalized

    def put_bytes(
        self, *, key: str, content: bytes, content_type: str | None = None
    ) -> ObjectWriteResult:
        key = self._key(key)
        self.objects[key] = (bytes(content), content_type)
        return ObjectWriteResult(object_key=key, size_bytes=len(content))

    def exists(self, key: str) -> bool:
        return self._key(key) in self.objects

    def read_bytes(self, key: str) -> bytes:
        try:
            return self.objects[self._key(key)][0]
        except KeyError as exc:
            raise ObjectNotFoundError("Missing object") from exc

    def object_metadata(self, key: str) -> ObjectMetadata:
        data = self.read_bytes(key)
        return ObjectMetadata(len(data), self.objects[self._key(key)][1], _etag(data))

    def iter_bytes(
        self,
        key: str,
        *,
        chunk_size: int = 1024 * 1024,
        start: int | None = None,
        end: int | None = None,
    ) -> Iterator[bytes]:
        data = self.read_bytes(key)[start or 0 : None if end is None else end + 1]
        for offset in range(0, len(data), chunk_size):
            yield data[offset : offset + chunk_size]

    def copy(self, source_key: str, target_key: str) -> None:
        data = self.read_bytes(source_key)
        self.put_bytes(
            key=target_key, content=data, content_type=self.objects[self._key(source_key)][1]
        )

    def delete(self, key: str) -> None:
        self.objects.pop(self._key(key), None)

    def generate_put_upload_url(
        self, key: str, *, content_type: str, content_length: int, expires_in: int | None = None
    ) -> DirectUploadTarget:
        return self._target(key, content_type, content_length, expires_in, None, None)

    def _target(self, key, content_type, length, ttl, upload_id, part_number):
        ttl = settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS if ttl is None else ttl
        if type(length) is not int or length <= 0 or type(ttl) is not int or ttl <= 0:
            raise ValueError("Positive integer length and expiry required")
        key = self._key(key)
        url = f"https://objects.example/{quote(key)}?signature={uuid4().hex}"
        self.targets[url] = (key, content_type, length, upload_id, part_number)
        return DirectUploadTarget(
            url,
            "PUT",
            {
                "content-length": str(length),
                **({"content-type": content_type} if content_type else {}),
            },
        )

    def receive_upload(self, target: DirectUploadTarget, content: bytes) -> None:
        key, content_type, length, upload_id, number = self.targets[target.upload_url]
        if len(content) != length or target.upload_headers.get("content-length") != str(length):
            raise ObjectStorageOperationFailedError("Content length does not match signature")
        if content_type and target.upload_headers.get("content-type") != content_type:
            raise ObjectStorageOperationFailedError("Content type does not match signature")
        if upload_id is None:
            self.put_bytes(key=key, content=content, content_type=content_type)
        else:
            self._multipart(key, upload_id).parts[number] = content

    def _multipart(self, key, upload_id):
        upload = self.uploads.get(upload_id)
        if upload is None or upload.key != self._key(key):
            raise ObjectNotFoundError("Missing upload handle")
        return upload

    def create_multipart_upload(self, key: str, *, content_type: str) -> str:
        identity = uuid4().hex
        self.uploads[identity] = _Multipart(self._key(key), content_type)
        return identity

    def generate_part_upload_url(
        self,
        key: str,
        upload_id: str,
        part_number: int,
        *,
        content_length: int,
        expires_in: int | None = None,
    ) -> DirectUploadTarget:
        self._multipart(key, upload_id)
        if type(part_number) is not int or not 1 <= part_number <= 10000:
            raise ValueError("Invalid part number")
        return self._target(key, None, content_length, expires_in, upload_id, part_number)

    def list_multipart_uploads(self, key: str) -> tuple[str, ...]:
        return tuple(
            identity for identity, upload in self.uploads.items() if upload.key == self._key(key)
        )

    def list_uploaded_parts(self, key: str, upload_id: str) -> tuple[UploadedPart, ...]:
        upload = self._multipart(key, upload_id)
        return tuple(
            UploadedPart(n, _etag(data), len(data)) for n, data in sorted(upload.parts.items())
        )

    def complete_multipart_upload(
        self, key: str, upload_id: str, parts: tuple[UploadedPart, ...]
    ) -> MultipartUploadResult:
        upload = self._multipart(key, upload_id)
        expected = self.list_uploaded_parts(key, upload_id)
        if not parts or parts != expected:
            raise ObjectStorageOperationFailedError("Invalid multipart manifest")
        if any(p.size_bytes < 5 * 1024 * 1024 for p in parts[:-1]):
            raise ObjectStorageOperationFailedError("Non-final part too small")
        content = b"".join(upload.parts[p.part_number] for p in parts)
        self.put_bytes(key=key, content=content, content_type=upload.content_type)
        del self.uploads[upload_id]
        return MultipartUploadResult(etag=_etag(content))

    def abort_multipart_upload(self, key: str, upload_id: str) -> None:
        if upload_id in self.uploads:
            self._multipart(key, upload_id)
            del self.uploads[upload_id]

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        expires_seconds: int | None = None,
    ) -> str:
        return f"https://objects.example/{quote(self._key(key))}"


def _etag(data: bytes) -> str:
    return '"' + md5(data, usedforsecurity=False).hexdigest() + '"'


@dataclass
class _Multipart:
    key: str
    content_type: str
    parts: dict[int, bytes] = field(default_factory=dict)
