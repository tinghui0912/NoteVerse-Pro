"""Email delivery helpers."""

import json
from urllib import error, request

from app.core.config import settings


class MailTransientError(RuntimeError):
    """A mail provider failure that may succeed on retry."""


class MailPermanentError(RuntimeError):
    """A mail provider failure caused by configuration, authorization, or input."""


def send_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
) -> str | None:
    """Send an email using Resend's transactional email API."""

    return _send_resend(to_email=to_email, subject=subject, body=body, html_body=html_body)


def _send_resend(
    *,
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None,
) -> str | None:
    sender = settings.MAIL_DEFAULT_SENDER
    if not settings.RESEND_API_KEY or not sender:
        raise MailPermanentError("Resend mail provider is not configured")

    payload: dict[str, object] = {
        "from": sender,
        "to": [to_email],
        "subject": subject,
        "text": body,
    }
    if html_body:
        payload["html"] = html_body

    api_request = request.Request(
        settings.RESEND_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.RESEND_API_KEY}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": f"{settings.PROJECT_NAME}/transactional-mail",
        },
        method="POST",
    )

    try:
        with request.urlopen(api_request, timeout=15) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            if response.status >= 300:
                _raise_resend_error(response.status, response_body)
            try:
                payload = json.loads(response_body)
            except json.JSONDecodeError:
                return None
            message_id = payload.get("id") if isinstance(payload, dict) else None
            return message_id if isinstance(message_id, str) else None
    except error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        try:
            _raise_resend_error(exc.code, response_body)
        except MailPermanentError as mail_exc:
            raise mail_exc from exc
        except MailTransientError as mail_exc:
            raise mail_exc from exc
    except Exception as exc:
        if isinstance(exc, MailPermanentError | MailTransientError):
            raise
        raise MailTransientError(f"Failed to send email with Resend: {exc}") from exc
    return None


def _raise_resend_error(status_code: int, response_body: str) -> None:
    message = f"Resend API returned {status_code}: {response_body}"
    if status_code == 429 or status_code >= 500:
        raise MailTransientError(message)
    raise MailPermanentError(message)
