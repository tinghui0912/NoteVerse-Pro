"""Opaque, scope-bound continuation for Score collaboration collections."""

import base64
import binascii
import json
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.exceptions import ValidationException
from app.shared.time import require_utc

DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 100
CollectionKind = Literal["invites", "members", "pending_invites"]


class _Cursor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    version: int
    kind: CollectionKind
    scope: str
    created_at: str
    row_id: int = Field(gt=0, le=2**63 - 1)


def encode_cursor(kind: CollectionKind, scope: str, created_at: datetime, row_id: int) -> str:
    payload = _Cursor(
        version=1,
        kind=kind,
        scope=scope,
        created_at=require_utc(created_at).isoformat(timespec="microseconds"),
        row_id=row_id,
    )
    raw = json.dumps(payload.model_dump(), sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unique_fields(pairs):
    fields = {}
    for key, value in pairs:
        if key in fields:
            raise ValueError("Duplicate cursor field")
        fields[key] = value
    return fields


def decode_cursor(
    cursor: str | None, *, kind: CollectionKind, scope: str
) -> tuple[datetime, int] | None:
    if cursor is None:
        return None
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", cursor):
            raise ValueError("Invalid cursor encoding")
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        payload = _Cursor.model_validate(json.loads(raw, object_pairs_hook=_unique_fields))
        created_at = require_utc(datetime.fromisoformat(payload.created_at))
        if (
            payload.version != 1
            or payload.kind != kind
            or payload.scope != scope
            or created_at.isoformat(timespec="microseconds") != payload.created_at
        ):
            raise ValueError("Invalid cursor position")
        return created_at, payload.row_id
    except (ValueError, TypeError, UnicodeError, binascii.Error, RecursionError):
        raise ValidationException(field="cursor") from None
