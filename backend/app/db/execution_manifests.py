"""Persistence helpers for normalized, content-addressed execution manifests."""

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.db.models import ExecutionManifest


def manifest_sha256(manifest: dict[str, object]) -> str:
    """Return the canonical digest for a JSON-compatible execution manifest."""

    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def get_or_create_execution_manifest(db: Session, manifest: dict[str, object]) -> ExecutionManifest:
    """Return the normalized record for a manifest without committing the session."""

    digest = manifest_sha256(manifest)
    record = db.execute(
        select(ExecutionManifest).where(ExecutionManifest.sha256 == digest)
    ).scalar_one_or_none()
    if record is None:
        record = ExecutionManifest(sha256=digest, manifest=manifest)
        db.add(record)
        db.flush()
    return record


async def get_or_create_execution_manifest_async(
    db: AsyncSession, manifest: dict[str, object]
) -> ExecutionManifest:
    """Async counterpart that leaves transaction ownership with the caller."""

    digest = manifest_sha256(manifest)
    record = (
        await db.execute(select(ExecutionManifest).where(ExecutionManifest.sha256 == digest))
    ).scalar_one_or_none()
    if record is None:
        record = ExecutionManifest(sha256=digest, manifest=manifest)
        db.add(record)
        await db.flush()
    return record
