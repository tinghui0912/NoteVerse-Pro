from __future__ import annotations

import hashlib


_NAMESPACE = "noteverse:scheduler"


def scheduler_lock_key(scope: str) -> int:
    """Return a stable signed bigint key for a PostgreSQL advisory lock."""

    digest = hashlib.sha256(f"{_NAMESPACE}:{scope}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)
