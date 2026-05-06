"""Shared mail-dispatch boundary used by feature services."""

from celery.result import AsyncResult


def dispatch_email(to_email: str, subject: str, body: str) -> AsyncResult:
    """Enqueue an email for background delivery."""
    from app.worker.tasks import send_email_task

    return send_email_task.delay(to_email, subject, body)
