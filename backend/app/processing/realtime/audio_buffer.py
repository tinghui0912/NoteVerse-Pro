from __future__ import annotations

from collections import deque


class AudioChunkBuffer:
    """Bounded in-memory buffer for PCM chunks."""

    def __init__(self, max_chunks: int = 512) -> None:
        self._chunks: deque[bytes] = deque(maxlen=max_chunks)

    def append(self, chunk: bytes) -> None:
        if chunk:
            self._chunks.append(chunk)

    def pop_all(self) -> list[bytes]:
        chunks = list(self._chunks)
        self._chunks.clear()
        return chunks

    def clear(self) -> None:
        self._chunks.clear()

    def __len__(self) -> int:
        return len(self._chunks)
