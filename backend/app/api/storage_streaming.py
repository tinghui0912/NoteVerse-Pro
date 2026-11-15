from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote

from fastapi import Request, status
from fastapi.responses import Response, StreamingResponse

from app.storage import ObjectStorage
from app.modules.storage_objects.reads import StoredObjectDelivery, iterate_admitted_bytes

DEFAULT_STREAM_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class ByteRange:
    start: int
    end: int


def stream_storage_object(
    *,
    storage: ObjectStorage,
    target: StoredObjectDelivery,
    attachment: bool,
    request: Request | None = None,
    enable_range: bool = False,
    chunk_size: int = DEFAULT_STREAM_CHUNK_SIZE,
) -> Response:
    size = target.byte_size
    headers = {
        "Content-Disposition": _content_disposition(target.filename, attachment=attachment),
        "Content-Length": str(size),
    }
    if enable_range:
        headers["Accept-Ranges"] = "bytes"

    if not enable_range or request is None:
        return StreamingResponse(
            iterate_admitted_bytes(storage, target, chunk_size=chunk_size),
            media_type=target.media_type,
            headers=headers,
        )

    parsed_range = _parse_byte_range(request.headers.get("range"), size)
    if parsed_range is None:
        return StreamingResponse(
            iterate_admitted_bytes(storage, target, chunk_size=chunk_size),
            media_type=target.media_type,
            headers=headers,
        )
    if parsed_range == "invalid":
        return Response(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"},
        )

    content_length = parsed_range.end - parsed_range.start + 1
    range_headers = {
        **headers,
        "Content-Length": str(content_length),
        "Content-Range": f"bytes {parsed_range.start}-{parsed_range.end}/{size}",
    }
    return StreamingResponse(
        iterate_admitted_bytes(
            storage,
            target,
            chunk_size=chunk_size,
            start=parsed_range.start,
            end=parsed_range.end,
        ),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type=target.media_type,
        headers=range_headers,
    )


def _content_disposition(filename: str, *, attachment: bool) -> str:
    disposition = "attachment" if attachment else "inline"
    return f"{disposition}; filename*=UTF-8''{quote(filename)}"


def _parse_byte_range(header: str | None, size: int) -> ByteRange | Literal["invalid"] | None:
    if not header:
        return None
    if not header.startswith("bytes=") or "," in header:
        return "invalid"

    start_text, separator, end_text = header.removeprefix("bytes=").partition("-")
    if separator != "-":
        return "invalid"
    if not start_text and not end_text:
        return "invalid"

    try:
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else size - 1
        else:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                return "invalid"
            start = max(size - suffix_length, 0)
            end = size - 1
    except ValueError:
        return "invalid"

    if start < 0 or end < start or start >= size:
        return "invalid"
    return ByteRange(start=start, end=min(end, size - 1))
