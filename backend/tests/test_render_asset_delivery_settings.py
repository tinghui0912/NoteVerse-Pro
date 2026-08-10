import pytest
from pydantic import ValidationError

from app.core.settings.render_asset_delivery import RenderAssetDeliverySettings


def test_render_asset_delivery_settings_allow_zero_historical_revisions() -> None:
    settings = RenderAssetDeliverySettings(DERIVED_ASSET_RETAIN_RECENT_REVISIONS=0)

    assert settings.DERIVED_ASSET_RETAIN_RECENT_REVISIONS == 0


@pytest.mark.parametrize(
    "field_name",
    (
        "RENDER_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "RENDER_OUTBOX_RETRY_BASE_SECONDS",
        "RENDER_OUTBOX_MAX_ATTEMPTS",
        "RENDER_OUTBOX_DISPATCH_BATCH_SIZE",
        "DERIVED_ASSET_CLEANUP_INTERVAL_SECONDS",
    ),
)
def test_render_asset_delivery_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="render asset delivery settings must be positive"):
        RenderAssetDeliverySettings(**{field_name: 0})


def test_render_asset_delivery_settings_reject_negative_retention_count() -> None:
    with pytest.raises(ValidationError, match="DERIVED_ASSET_RETAIN_RECENT_REVISIONS"):
        RenderAssetDeliverySettings(DERIVED_ASSET_RETAIN_RECENT_REVISIONS=-1)
