from app.modules.import_jobs.service import ImportJobService


def get_import_job_service() -> ImportJobService:
    return ImportJobService()
