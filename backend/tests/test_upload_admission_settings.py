import pytest
from pydantic import ValidationError

from app.core.settings.upload_admission import UploadAdmissionSettings


def test_upload_admission_settings_accept_default_allowlist() -> None:
    settings = UploadAdmissionSettings()

    assert settings.ALLOWED_EXTENSIONS == frozenset(
        {"png", "jpg", "jpeg", "bmp", "gif", "webp", "tiff", "tif"}
    )


@pytest.mark.parametrize(
    "extensions",
    (frozenset(), frozenset({".png"}), frozenset({"PNG"})),
)
def test_upload_admission_settings_reject_invalid_allowlists(
    extensions: frozenset[str],
) -> None:
    with pytest.raises(ValidationError, match="ALLOWED_EXTENSIONS"):
        UploadAdmissionSettings(ALLOWED_EXTENSIONS=extensions)
