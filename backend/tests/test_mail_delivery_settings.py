import pytest
from pydantic import ValidationError

from app.core.settings.mail_delivery import MailDeliverySettings


def test_mail_delivery_settings_accept_default_policy() -> None:
    settings = MailDeliverySettings()

    assert settings.MAIL_OUTBOX_RETENTION_DAYS == 7


@pytest.mark.parametrize(
    "field_name",
    (
        "MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_RETRY_BASE_SECONDS",
        "MAIL_OUTBOX_MAX_ATTEMPTS",
        "MAIL_OUTBOX_DISPATCH_BATCH_SIZE",
        "MAIL_OUTBOX_RETENTION_DAYS",
    ),
)
def test_mail_delivery_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="mail delivery settings must be positive"):
        MailDeliverySettings(**{field_name: 0})
