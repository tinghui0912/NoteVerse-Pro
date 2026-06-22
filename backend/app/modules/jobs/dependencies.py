from app.modules.jobs.service import JobService


def get_job_service() -> JobService:
    return JobService()
