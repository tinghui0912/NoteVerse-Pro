"""Head-exact delivery and owner-exact disposal of derived presentation."""

from tests.support.retirement import drain_retirements


import pytest
from sqlalchemy import select, func
from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ScoreRevisionSource,
    ScoreRevision,
    StorageUsageCategory,
    StorageUsageCounter,
    PlaybackOutbox,
    PlaybackOutboxStatus,
)
from app.modules.revisions.derived_asset_retention_service import DerivedAssetRetentionService
from app.modules.revisions.service import RevisionService
from app.modules.revisions.schemas import RevisionCreateRequest
from app.modules.scores.service import ScoreService
from app.modules.playback.delivery import PlaybackDeliveryReadModel
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.guest_previews.service import GuestPreviewService
from app.modules.guest_previews.schemas import GuestPreviewUpdateRequest
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from tests.test_revision_derivative_demand import revisions as revisions
from tests.test_guest_previews import add_page, add_audio
from tests.test_score_revision_services import MUSICXML_2
from tests.test_score_revision_services import score_service_session as score_service_session


def seed_assets(db, storage, rows):
    for revision in rows:
        add_page(db, storage, revision.id, f"page-{revision.id}")
        add_audio(db, storage, revision.id)
    keys = {}
    for model, category in (
        (ScoreRenderAsset, StorageUsageCategory.DERIVED_RENDER),
        (ScorePlaybackAsset, StorageUsageCategory.DERIVED_AUDIO),
    ):
        for asset in db.scalars(select(model)).all():
            keys[(category, asset.revision_id)] = asset.stored_object.object_key
            storage_usage_service.record_allocation(
                db,
                user_id=1,
                category=category,
                bytes_count=asset.stored_object.byte_size,
                reason="test",
                object_type=model.__tablename__,
                object_id=asset.asset_uuid,
                storage_key=asset.stored_object.object_key,
            )
    db.commit()
    return keys


def test_head_projection_and_playback_do_not_read_other_revision(revisions):
    db, storage, score, rows = revisions
    seed_assets(db, storage, rows[:1])
    detail = ScoreService(storage=storage).get(db, score.score_uuid, 1)
    assert detail.head_revision_id == rows[2].revision_uuid
    assert detail.derived_assets.model_dump() == {
        "preview": {"status": "processing", "asset_id": None},
        "audio": {"status": "processing", "asset_id": None},
    }
    delivery = PlaybackDeliveryReadModel(storage=storage, access_policy=ScoreAccessPolicy())
    with pytest.raises(ResourceNotFoundException) as missing:
        delivery.delivery_for_revision(db, rows[2].id)
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("mode", ["async", "sync", "daily"])
def test_only_head_protects_rows_objects_and_usage(revisions, enabled, mode):
    db, storage, score, rows = revisions
    keys = seed_assets(db, storage, rows)
    score.guest_preview_enabled = enabled
    db.commit()
    cleanup = DerivedAssetRetentionService()
    if mode == "async":
        result = cleanup.cleanup_for_score(db, score_id=score.id)
    elif mode == "sync":
        result = cleanup.cleanup_for_score(db, score_id=score.id)
    else:
        result = cleanup.cleanup_due_scores(db)
    protected = {rows[2].id}
    assert result.rendered_pages_deleted == result.playback_assets_deleted == 3 - len(protected)
    assert result.object_retirements_queued == 2 * (3 - len(protected))
    for model in (ScoreRenderAsset, ScorePlaybackAsset):
        assert set(db.scalars(select(model.revision_id))) == protected
    assert all(storage.exists(key) for key in keys.values())
    outcomes = drain_retirements(db, storage)
    assert len(outcomes) == result.object_retirements_queued
    assert all(item["status"] == "completed" for item in outcomes)
    for (_, revision_id), key in keys.items():
        assert storage.exists(key) == (revision_id in protected)
    for category in (StorageUsageCategory.DERIVED_RENDER, StorageUsageCategory.DERIVED_AUDIO):
        expected_bytes = sum(
            len(storage.read_bytes(key))
            for (kind, revision_id), key in keys.items()
            if kind == category and revision_id in protected
        )
        assert (
            db.scalar(
                select(StorageUsageCounter.used_bytes).where(
                    StorageUsageCounter.user_id == 1, StorageUsageCounter.category == category
                )
            )
            == expected_bytes
        )
    assert db.scalar(select(func.count()).select_from(ScoreRevision)) == 3
    sources = db.scalars(select(ScoreRevisionSource)).all()
    assert len(sources) == 3 and all(
        storage.exists(source.stored_object.object_key) for source in sources
    )


@pytest.mark.parametrize("active_preview", [False, True])
def test_background_retention_disposes_old_head_while_new_derivatives_are_pending(
    revisions, active_preview
):
    db, storage, score, rows = revisions
    keys = seed_assets(db, storage, rows[2:])
    token = None
    previews = GuestPreviewService(storage=storage)
    if active_preview:
        token = (
            previews.update_settings(
                db,
                score.score_uuid,
                1,
                GuestPreviewUpdateRequest(enabled=True),
            )
        ).token
    created = RevisionService(storage=storage).create(
        db,
        score.score_uuid,
        1,
        RevisionCreateRequest(
            content=MUSICXML_2.replace("<step>C</step>", "<step>F</step>"),
            expected_head_revision_id=rows[2].revision_uuid,
        ),
    )
    assert created.revision_number == 4
    assert (
        db.scalar(
            select(PlaybackOutbox.status)
            .join(ScoreRevision)
            .where(ScoreRevision.revision_uuid == created.revision_id)
        )
        == PlaybackOutboxStatus.PENDING
    )
    assert db.scalar(select(ScoreRenderAsset)) is not None
    DerivedAssetRetentionService().cleanup_for_score(db, score_id=score.id)
    assert db.scalar(select(ScoreRenderAsset)) is None
    assert db.scalar(select(ScorePlaybackAsset)) is None
    assert all(storage.exists(key) for key in keys.values())
    outcomes = drain_retirements(db, storage)
    assert len(outcomes) == 2
    assert all(item["status"] == "completed" for item in outcomes)
    assert all(not storage.exists(key) for key in keys.values())
    if token:
        read = previews.read(db, token)
        assert not read.audio_available and read.render_assets == []
