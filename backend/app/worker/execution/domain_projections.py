"""Periodic catch-up of registered durable database projections."""

from app.db.session import SessionLocal
from app.modules.domain_events.projections import run_projections
from app.modules.import_jobs.projections import IMPORT_PROJECTIONS
from app.modules.revisions.projections import REVISION_PROJECTIONS
from app.worker.task_runtime import run_scheduler_scan

DOMAIN_PROJECTIONS = (*IMPORT_PROJECTIONS, *REVISION_PROJECTIONS)


def execute_domain_projection_maintenance() -> dict[str, int]:
    def scan() -> dict[str, int]:
        with SessionLocal() as db:
            processed = run_projections(db, DOMAIN_PROJECTIONS)
            db.commit()
        return {"processed": processed}

    return run_scheduler_scan("domain_projections", scan)
