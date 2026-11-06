"""Unit-test object namespace; integration tests exercise the concrete adapter separately."""

from collections.abc import Iterator
from pathlib import Path
from urllib.parse import quote
from app.storage.base import DirectUploadTarget, StoredFile, StoredObjectMetadata


class InMemoryObjectStorage:
    def __init__(self, *, objects: dict[str, tuple[bytes, str | None]] | None = None):
        self.objects = objects if objects is not None else {}

    @staticmethod
    def _key(key: str) -> str:
        normalized = key.replace("\\", "/").strip("/")
        if not normalized or any(part in {".", ".."} for part in normalized.split("/")):
            raise ValueError("Invalid object key")
        return normalized

    def put_bytes(self, *, key: str, content: bytes, content_type: str | None = None) -> StoredFile:
        key = self._key(key)
        self.objects[key] = (bytes(content), content_type)
        return StoredFile(key, key.rsplit("/", 1)[-1], key, len(content), self.public_url(key))

    def exists(self, key: str) -> bool:
        return self._key(key) in self.objects

    def read_bytes(self, key: str) -> bytes:
        try:
            return self.objects[self._key(key)][0]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    def size_bytes(self, key: str) -> int:
        return len(self.read_bytes(key))

    def object_metadata(self, key: str) -> StoredObjectMetadata:
        return StoredObjectMetadata(self.size_bytes(key), self.objects[self._key(key)][1])

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

    def delete(self, key: str) -> bool:
        return self.objects.pop(self._key(key), None) is not None

    def upload_url(
        self, key: str, *, content_type: str, checksum_sha256: str
    ) -> DirectUploadTarget:
        return DirectUploadTarget(
            f"https://objects.example/{quote(self._key(key))}",
            "PUT",
            {"content-type": content_type},
        )

    def public_url(self, key: str) -> str:
        return f"https://objects.example/{quote(self._key(key))}"

    def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        expires_seconds: int | None = None,
    ) -> str:
        return self.public_url(key)

    def materialize_to_local(self, key: str, target_path: str) -> str:
        path = Path(target_path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.read_bytes(key))
        return str(path)

    def save_blob(
        self, *, content: bytes, sha256: str, extension: str, content_type: str | None = None
    ) -> StoredFile:
        return self.put_bytes(
            key=f"blobs/{sha256[:2]}/{sha256}{extension}",
            content=content,
            content_type=content_type,
        )

    def save_avatar(self, *, content: bytes, filename: str) -> StoredFile:
        return self.put_bytes(key=f"avatars/{filename}", content=content, content_type="image/jpeg")

    def avatar_url(self, filename: str) -> str:
        return self.public_url(f"avatars/{filename}")

    def delete_avatar(self, filename: str) -> bool:
        return self.delete(f"avatars/{filename}")
