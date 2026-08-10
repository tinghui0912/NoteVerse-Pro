import pytest
from pydantic import ValidationError

from app.core.settings.import_dispatch import ImportDispatchSettings


def test_import_dispatch_settings_accept_default_policy() -> None:
    settings = ImportDispatchSettings()

    assert settings.IMPORT_DISPATCH_MAX_ATTEMPTS == 3
    assert settings.ORPHAN_UPLOAD_TTL_SECONDS == 86400


@pytest.mark.parametrize(
    "field_name",
    (
        "IMPORT_DISPATCH_INTERVAL_SECONDS",
        "IMPORT_DISPATCH_TIMEOUT_SECONDS",
        "IMPORT_PROCESSING_TIMEOUT_SECONDS",
        "IMPORT_DISPATCH_MAX_ATTEMPTS",
        "IMPORT_DISPATCH_BATCH_SIZE",
        "ORPHAN_UPLOAD_TTL_SECONDS",
    ),
)
def test_import_dispatch_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="import dispatch settings must be positive"):
        ImportDispatchSettings(**{field_name: 0})
