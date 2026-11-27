"""Resolve and persist immutable OMR execution identity for import jobs."""

from sqlalchemy.orm import Session

from app.db.execution_manifests import get_or_create_execution_manifest
from app.db.model_utils import require_persisted_id
from app.modules.import_jobs.dispatch_service import ImportExecutionLease, require_current_attempt
from app.processing.engines.omr.legato_manifest import legato_execution_identity


def build_omr_manifest() -> dict[str, object]:
    return legato_execution_identity()


def bind_import_job_execution_manifest(db: Session, lease: ImportExecutionLease) -> None:
    """Bind a job once to its resolved OMR identity; retries preserve the binding."""

    job = require_current_attempt(db, lease)
    if job.execution_manifest_id is not None:
        return
    record = get_or_create_execution_manifest(db, build_omr_manifest())
    job.execution_manifest_id = require_persisted_id(record.id, entity="execution manifest")
    db.commit()
