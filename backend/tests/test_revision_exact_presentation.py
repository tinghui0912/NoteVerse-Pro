"""Head-exact delivery and owner-exact disposal of derived presentation."""

from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import select, func
from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ScoreRevisionSource,
    ScoreRevision,
    ScoreGuestPreviewGrant,
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
from app.modules.guest_previews.schemas import GuestPreviewCreateRequest
from app.modules.storage_usage.service import storage_usage_service
from app.utils.timezone import utc_now_naive
from app.shared.constants import ErrorCode
from tests.test_revision_derivative_demand import revisions as revisions
from tests.test_guest_previews import add_page, add_audio
from tests.test_score_revision_services import AsyncSessionAdapter, MUSICXML_2
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
            keys[(category, asset.revision_id)] = asset.storage_key
            storage_usage_service.record_allocation_sync(
                db,
                user_id=1,
                category=category,
                bytes_count=asset.size_bytes,
                reason="test",
                object_type=model.__tablename__,
                object_id=asset.asset_uuid,
                storage_key=asset.storage_key,
            )
    return keys


@pytest.mark.asyncio
async def test_head_projection_and_playback_do_not_read_other_revision(revisions):
    db, storage, score, rows = revisions
    seed_assets(db, storage, rows[:1])
    detail = await ScoreService(storage=storage).get(AsyncSessionAdapter(db), score.score_uuid, 1)
    assert detail.head_revision_id == rows[2].revision_uuid
    assert detail.derived_assets.model_dump() == {
        "preview": {"status": "processing", "asset_id": None},
        "audio": {"status": "processing", "asset_id": None},
    }
    delivery = PlaybackDeliveryReadModel(storage=storage, access_policy=ScoreAccessPolicy())
    with pytest.raises(ResourceNotFoundException) as missing:
        await delivery.delivery_for_revision(AsyncSessionAdapter(db), rows[2].id)
    assert missing.value.code == ErrorCode.FILE_NOT_FOUND


@pytest.mark.asyncio
@pytest.mark.parametrize("pin", ["none", "active", "revoked", "expired"])
@pytest.mark.parametrize("mode", ["async", "sync", "daily"])
async def test_only_head_and_active_pins_protect_rows_objects_and_usage(revisions, pin, mode):
    db, storage, score, rows = revisions
    keys = seed_assets(db, storage, rows)
    if pin != "none":
        db.add(
            ScoreGuestPreviewGrant(
                score_id=score.id,
                revision_id=rows[0].id,
                token_hash="d" * 64,
                expires_at=utc_now_naive() + timedelta(days=1)
                if pin != "expired"
                else utc_now_naive() - timedelta(days=1),
                revoked_at=utc_now_naive() if pin == "revoked" else None,
                created_by_user_id=1,
            )
        )
        db.commit()
    cleanup = DerivedAssetRetentionService(storage)
    if mode == "async":
        result = await cleanup.cleanup_for_score(AsyncSessionAdapter(db), score_id=score.id)
    elif mode == "sync":
        result = cleanup.cleanup_for_score_sync(db, score_id=score.id)
    else:
        result = cleanup.cleanup_due_scores(db)
    protected = {rows[2].id} | ({rows[0].id} if pin == "active" else set())
    assert result.rendered_pages_deleted == result.playback_assets_deleted == 3 - len(protected)
    assert result.storage_objects_deleted == 2 * (3 - len(protected))
    for model in (ScoreRenderAsset, ScorePlaybackAsset):
        assert set(db.scalars(select(model.revision_id))) == protected
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
    assert len(sources) == 3 and all(storage.exists(source.storage_key) for source in sources)


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["revoke", "delete"])
@pytest.mark.parametrize("cleanup_fails", [False, True])
async def test_preview_command_releases_last_historical_pin_after_commit(
    revisions, command, cleanup_fails, monkeypatch
):
    db, storage, score, rows = revisions
    score.head_revision_id = rows[0].id
    db.commit()
    service = GuestPreviewService(storage=storage)
    created = await service.create(
        AsyncSessionAdapter(db), score.score_uuid, 1, GuestPreviewCreateRequest()
    )
    keys = seed_assets(db, storage, rows[:1])
    score.head_revision_id = rows[2].id
    db.commit()
    if cleanup_fails:
        monkeypatch.setattr(
            DerivedAssetRetentionService,
            "_delete_storage_objects",
            Mock(side_effect=RuntimeError("cleanup unavailable")),
        )
    await getattr(service, command)(AsyncSessionAdapter(db), created.preview_id, 1)
    preview = db.scalar(select(ScoreGuestPreviewGrant))
    assert preview is None if command == "delete" else preview.revoked_at is not None
    assert db.scalar(select(func.count()).select_from(ScoreRenderAsset)) == 0
    assert db.scalar(select(func.count()).select_from(ScorePlaybackAsset)) == 0
    if not cleanup_fails:
        assert not any(storage.exists(key) for key in keys.values())


@pytest.mark.asyncio
@pytest.mark.parametrize("active_preview", [False, True])
async def test_save_disposes_old_head_before_new_derivatives_are_ready(revisions, active_preview):
    db, storage, score, rows = revisions
    keys = seed_assets(db, storage, rows[2:])
    token = None
    previews = GuestPreviewService(storage=storage)
    if active_preview:
        token = (
            await previews.create(
                AsyncSessionAdapter(db), score.score_uuid, 1, GuestPreviewCreateRequest()
            )
        ).token
    created = await RevisionService(storage=storage).create(
        AsyncSessionAdapter(db),
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
    assert bool(db.scalar(select(ScoreRenderAsset))) == active_preview
    assert bool(db.scalar(select(ScorePlaybackAsset))) == active_preview
    assert all(storage.exists(key) == active_preview for key in keys.values())
    if token:
        read = await previews.read(AsyncSessionAdapter(db), token)
        assert read.audio_available and len(read.render_assets) == 1
