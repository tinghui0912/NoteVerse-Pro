"""Revision metadata delivery has one validated operational settings owner."""

import pytest
from pydantic import ValidationError

from app.platform.config.revision_metadata_delivery import RevisionMetadataDeliverySettings
from app.modules.metadata.delivery_states import RevisionMetadataOutboxStatus
from app.modules.revisions.metadata_delivery import metadata_lifecycle
from app.task_queue.schedule import build_beat_schedule
from app.runtime.customer_api.context import get_context
from app.runtime.customer_api.settings import CustomerApiSettings
from app.runtime.beat.settings import BeatSettings
from app.platform.config.queue_schedule import QueueScheduleConfig

settings = get_context().settings


def test_metadata_defaults_match_delivery_and_schedule():
    assert RevisionMetadataDeliverySettings().model_dump() == {
        "REVISION_METADATA_DISPATCH_INTERVAL_SECONDS": 5,
        "REVISION_METADATA_DISPATCH_BATCH_SIZE": 50,
        "REVISION_METADATA_MAX_ATTEMPTS": 5,
        "REVISION_METADATA_RETRY_BASE_SECONDS": 60,
        "REVISION_METADATA_DISPATCH_TIMEOUT_SECONDS": 300,
        "REVISION_METADATA_PROCESSING_TIMEOUT_SECONDS": 300,
    }
    lifecycle = metadata_lifecycle(
        config=RevisionMetadataDeliverySettings.model_validate(get_context().settings.model_dump())
    )
    assert all(
        isinstance(value, RevisionMetadataOutboxStatus)
        for value in vars(lifecycle.statuses).values()
    )


@pytest.mark.parametrize("name", RevisionMetadataDeliverySettings.model_fields)
@pytest.mark.parametrize("value", [0, -1])
def test_metadata_operational_settings_are_positive(name, value):
    with pytest.raises(ValidationError):
        RevisionMetadataDeliverySettings(**{name: value})


def test_metadata_lifecycle_and_beat_read_current_settings(monkeypatch):
    for name, value in {
        "REVISION_METADATA_DISPATCH_INTERVAL_SECONDS": 7,
        "REVISION_METADATA_MAX_ATTEMPTS": 3,
        "REVISION_METADATA_RETRY_BASE_SECONDS": 11,
        "REVISION_METADATA_DISPATCH_TIMEOUT_SECONDS": 13,
        "REVISION_METADATA_PROCESSING_TIMEOUT_SECONDS": 17,
    }.items():
        monkeypatch.setattr(settings, name, value)
    policy = metadata_lifecycle(
        config=RevisionMetadataDeliverySettings.model_validate(get_context().settings.model_dump())
    ).policy
    assert (
        policy.max_attempts,
        policy.retry_base_seconds,
        policy.dispatch_timeout_seconds,
        policy.processing_timeout_seconds,
    ) == (3, 11, 13, 17)
    assert (
        build_beat_schedule(
            QueueScheduleConfig(
                REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS=60,
                REVISION_METADATA_DISPATCH_INTERVAL_SECONDS=settings.REVISION_METADATA_DISPATCH_INTERVAL_SECONDS,
            )
        )["revision-metadata-maintenance"]["schedule"]
        == 7.0
    )


def test_metadata_settings_are_composed_into_runtime_settings(monkeypatch):

    monkeypatch.setenv("REVISION_METADATA_DISPATCH_INTERVAL_SECONDS", "19")
    monkeypatch.setenv("REVISION_METADATA_DISPATCH_BATCH_SIZE", "23")
    configured = CustomerApiSettings()
    assert configured.REVISION_METADATA_DISPATCH_BATCH_SIZE == 23
    assert build_beat_schedule(BeatSettings())["revision-metadata-maintenance"]["schedule"] == 19.0
