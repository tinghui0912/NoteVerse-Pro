"""Revision render identity is the exact revision/profile pair."""

import zipfile

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    ScoreRevision,
    ScoreRenderAsset,
    ScoreRevisionRenderOutbox,
    ScoreRevisionRenderStatus,
)
from app.db.models.score import RenderAssetKind
from app.modules.revisions.render_admission import admit_revision_render
from app.modules.revisions.render_queries import revision_render_status
from app.modules.score_assets.derived_assets import score_derived_assets
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.service import ScoreAssetService
from app.modules.storage_objects.persistence import object_from_bytes
from app.score_semantics.render_profile import SCORE_PRESENTATION_RENDER_PROFILE
from tests.test_score_revision_services import (
    score_service_session as score_service_session,
    add_active_score_with_head_revision,
)


def seed_score(db):
    return add_active_score_with_head_revision(
        db,
        score_id=701,
        revision_id=702,
        score_uuid="variant-score",
        revision_uuid="variant-revision",
        title="Variants",
    )


def add_page(db, storage, profile, page):
    content = f"<svg>{profile}:{page}</svg>".encode()
    key = f"variants/{profile}/{page}.svg"
    storage.put_bytes(key=key, content=content, content_type="image/svg+xml")
    asset = ScoreRenderAsset(
        asset_uuid=f"{profile}-{page}",
        revision_id=702,
        kind=RenderAssetKind.RENDERED_PAGE,
        stored_object=object_from_bytes(
            object_key=key, content=content, content_type="image/svg+xml"
        ),
        filename=f"{profile}-{page}.svg",
        render_profile=profile,
        page_number=page,
        generator="test",
        generator_version="1",
    )
    db.add(asset)
    return asset


@pytest.mark.parametrize(
    "status", [ScoreRevisionRenderStatus.PROCESSING, ScoreRevisionRenderStatus.COMPLETED]
)
def test_presentation_never_joins_an_asset_to_another_profile_status(score_service_session, status):
    db, storage = score_service_session
    seed_score(db)
    add_page(db, storage, "profile-a", 1)
    db.add(
        ScoreRevisionRenderOutbox(
            outbox_uuid="profile-b",
            score_id=701,
            revision_id=702,
            source_fingerprint="a" * 64,
            render_profile="profile-b",
            status=status,
            attempt_token="lease" if status is ScoreRevisionRenderStatus.PROCESSING else None,
        )
    )
    db.commit()
    repository = ScoreAssetRepository()
    assert repository.first_rendered_page_asset(db, 702, render_profile="profile-b") is None
    assert revision_render_status(db, 702, render_profile="profile-b") is status
    revision = db.get(ScoreRevision, 702)
    projected = score_derived_assets(db, repository, revision=revision)
    assert projected.preview.status == "pending" and projected.preview.asset_id is None
    canonical = admit_revision_render(
        db,
        score_id=701,
        revision_id=702,
        requested_by_user_id=1,
        source_fingerprint="a" * 64,
        render_profile=SCORE_PRESENTATION_RENDER_PROFILE,
    )
    db.flush()
    assert canonical.render_profile == SCORE_PRESENTATION_RENDER_PROFILE
    projected = score_derived_assets(db, repository, revision=revision)
    assert projected.preview.status == "processing" and projected.preview.asset_id is None
    page = add_page(db, storage, SCORE_PRESENTATION_RENDER_PROFILE, 1)
    db.commit()
    projected = score_derived_assets(db, repository, revision=revision)
    assert projected.preview.status == "ready" and projected.preview.asset_id == page.asset_uuid


def test_asset_list_exposes_variants_and_archive_selects_one_profile(score_service_session):
    db, storage = score_service_session
    seed_score(db)
    for profile in (SCORE_PRESENTATION_RENDER_PROFILE, "profile-b"):
        for page in (2, 1):
            add_page(db, storage, profile, page)
    db.commit()
    service = ScoreAssetService(storage=storage)
    listing = service.list_revision_assets(db, "variant-score", 1)
    assert {asset.render_profile for asset in listing.render_assets} == {
        SCORE_PRESENTATION_RENDER_PROFILE,
        "profile-b",
    }
    repository = ScoreAssetRepository()
    assert (
        repository.first_rendered_page_asset(db, 702, render_profile="profile-b").page_number == 1
    )
    archive, _ = service.render_asset_archive(
        db,
        "variant-score",
        1,
        revision_uuid="variant-revision",
        kind=RenderAssetKind.RENDERED_PAGE,
        render_profile="profile-b",
    )
    with zipfile.ZipFile(archive) as bundle:
        assert set(bundle.namelist()) == {"profile-b-1.svg", "profile-b-2.svg"}
        assert bundle.read("profile-b-1.svg") == b"<svg>profile-b:1</svg>"


def test_revision_profile_admission_and_database_uniqueness(score_service_session):
    db, _ = score_service_session
    seed_score(db)
    arguments = dict(
        score_id=701, revision_id=702, requested_by_user_id=1, source_fingerprint="a" * 64
    )
    first = admit_revision_render(db, **arguments, render_profile="profile-a")
    assert admit_revision_render(db, **arguments, render_profile="profile-a") is first
    second = admit_revision_render(db, **arguments, render_profile="profile-b")
    assert second.id != first.id
    db.commit()
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(
            ScoreRevisionRenderOutbox(
                outbox_uuid="duplicate",
                score_id=701,
                revision_id=702,
                source_fingerprint="a" * 64,
                render_profile="profile-a",
            )
        )
        db.flush()
    assert len(list(db.scalars(select(ScoreRevisionRenderOutbox)))) == 2
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text("UPDATE score_revision_render_outbox SET status='INVALID' WHERE id=:id"),
            {"id": first.id},
        )


@pytest.mark.parametrize("missing_field", ["render_profile", "page_number"])
def test_rendered_page_persistence_requires_explicit_variant_coordinates(
    score_service_session, missing_field
):
    db, _ = score_service_session
    seed_score(db)
    physical = object_from_bytes(
        object_key=f"variants/{missing_field}.svg",
        content=b"<svg/>",
        content_type="image/svg+xml",
    )
    db.add(physical)
    db.commit()
    values = dict(
        asset_uuid=f"missing-{missing_field}",
        revision_id=702,
        kind=RenderAssetKind.RENDERED_PAGE,
        stored_object_id=physical.id,
        filename="page.svg",
        generator="test",
        generator_version="1",
        render_profile="profile-a",
        page_number=1,
    )
    del values[missing_field]
    with pytest.raises(IntegrityError) as failure, db.begin_nested():
        db.execute(insert(ScoreRenderAsset.__table__).values(**values))
    assert failure.value.orig.sqlstate == "23502"
    assert failure.value.orig.diag.column_name == missing_field
    assert db.scalar(select(ScoreRenderAsset)) is None
