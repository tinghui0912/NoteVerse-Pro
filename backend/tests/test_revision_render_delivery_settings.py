import pytest
from pydantic import ValidationError

from app.core.settings.revision_render_delivery import RevisionRenderDeliverySettings


@pytest.mark.parametrize(
    "field_name",
    (
        "REVISION_RENDER_DISPATCH_INTERVAL_SECONDS",
        "REVISION_RENDER_DISPATCH_TIMEOUT_SECONDS",
        "REVISION_RENDER_PROCESSING_TIMEOUT_SECONDS",
        "REVISION_RENDER_RETRY_BASE_SECONDS",
        "REVISION_RENDER_MAX_ATTEMPTS",
        "REVISION_RENDER_DISPATCH_BATCH_SIZE",
    ),
)
def test_revision_render_delivery_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="revision render delivery settings must be positive"):
        RevisionRenderDeliverySettings(**{field_name: 0})


def test_derived_asset_retention_interval_is_positive() -> None:
    from app.core.settings.derived_asset_retention import DerivedAssetRetentionSettings

    with pytest.raises(ValidationError, match="cleanup interval must be positive"):
        DerivedAssetRetentionSettings(DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS=0)
