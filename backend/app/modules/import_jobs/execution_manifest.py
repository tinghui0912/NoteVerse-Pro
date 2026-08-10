"""Resolve and persist immutable OMR execution identity for import jobs."""

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_worker_runtime_settings
from app.db.model_utils import require_persisted_id
from app.db.models import ExecutionManifest, ImportJob


def build_omr_manifest() -> dict[str, object]:
    settings = get_worker_runtime_settings()
    return {
        "schema_version": 1,
        "kind": "omr",
        "engine": settings.OMR_ENGINE,
        "legato_commit": settings.LEGATO_REPO_COMMIT,
        "model": settings.LEGATO_MODEL_PATH,
        "processor": settings.LEGATO_PROCESSOR_PATH,
    }


def manifest_sha256(manifest: dict[str, object]) -> str:
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def bind_import_job_execution_manifest(db: Session, job_uuid: str) -> None:
    """Bind a job once to its resolved OMR identity; retries preserve the binding."""

    job = db.execute(select(ImportJob).where(ImportJob.job_uuid == job_uuid)).scalar_one_or_none()
    if job is None or job.execution_manifest_id is not None:
        return
    manifest = build_omr_manifest()
    digest = manifest_sha256(manifest)
    record = db.execute(
        select(ExecutionManifest).where(ExecutionManifest.sha256 == digest)
    ).scalar_one_or_none()
    if record is None:
        record = ExecutionManifest(sha256=digest, manifest=manifest)
        db.add(record)
        db.flush()
    job.execution_manifest_id = require_persisted_id(record.id, entity="execution manifest")
    db.commit()
