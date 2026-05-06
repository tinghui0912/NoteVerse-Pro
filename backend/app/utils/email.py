"""Email delivery helpers."""

import smtplib
import ssl
from email.mime.text import MIMEText

from app.core.config import settings


def send_email(to_email: str, subject: str, body: str) -> None:
    """Send a plain-text email using the configured SMTP settings."""

    if not (
        settings.MAIL_SERVER
        and settings.MAIL_PORT
        and settings.MAIL_USERNAME
        and settings.MAIL_PASSWORD
    ):
        raise RuntimeError("Mail server not configured")

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    sender = settings.MAIL_DEFAULT_SENDER or settings.MAIL_USERNAME
    msg["From"] = sender
    msg["To"] = to_email

    context = ssl.create_default_context()

    try:
        if settings.MAIL_USE_SSL:
            with smtplib.SMTP_SSL(
                settings.MAIL_SERVER,
                settings.MAIL_PORT,
                context=context,
            ) as server:
                server.login(settings.MAIL_USERNAME, settings.MAIL_PASSWORD)
                server.sendmail(
                    sender,
                    [to_email],
                    msg.as_string(),
                )
        else:
            with smtplib.SMTP(settings.MAIL_SERVER, settings.MAIL_PORT) as server:
                if settings.MAIL_USE_TLS:
                    server.starttls(context=context)
                server.login(settings.MAIL_USERNAME, settings.MAIL_PASSWORD)
                server.sendmail(
                    sender,
                    [to_email],
                    msg.as_string(),
                )
    except Exception as exc:
        raise RuntimeError(f"Failed to send email: {exc}") from exc
