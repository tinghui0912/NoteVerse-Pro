"""Periodic catch-up of registered durable database projections."""

from app.db.sync_session import get_worker_db
from app.modules.domain_events.projections import run_projections
from app.modules.import_jobs.projections import IMPORT_PROJECTIONS
from app.modules.revisions.projections import REVISION_PROJECTIONS
from app.worker.task_runtime import run_scheduler_scan

DOMAIN_PROJECTIONS = (*IMPORT_PROJECTIONS, *REVISION_PROJECTIONS)


def execute_domain_projection_maintenance() -> dict[str, int]:
    def scan() -> dict[str, int]:
        with get_worker_db() as db:
            processed = run_projections(db, DOMAIN_PROJECTIONS)
        return {"processed": processed}

    return run_scheduler_scan("domain_projections", scan)
