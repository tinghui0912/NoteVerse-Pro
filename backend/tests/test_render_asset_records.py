from types import SimpleNamespace
from typing import cast

from app.db.models import ScoreRenderAsset
from app.db.models.score import RenderAssetKind
from app.modules.score_assets.render_asset_records import (
    build_render_asset_record,
    render_asset_usage,
    render_storage_key,
)
from app.storage import StoredFile


def test_render_storage_key_uses_profile_and_page_scoped_asset_path() -> None:
    assert (
        render_storage_key(
            score_uuid="score-1",
            revision_uuid="revision-1",
            profile="default",
            page=3,
            asset_uuid="asset-1",
            extension=".svg",
        )
        == "scores/score-1/revisions/revision-1/renders/default/003-asset-1.svg"
    )


def test_render_asset_usage_captures_replacement_release_fields() -> None:
    usage = render_asset_usage(
        [
            cast(
                ScoreRenderAsset,
                SimpleNamespace(
                    asset_uuid="asset-old",
                    storage_key="scores/old.svg",
                    size_bytes=123,
                ),
            )
        ]
    )

    assert len(usage) == 1
    assert usage[0].asset_uuid == "asset-old"
    assert usage[0].storage_key == "scores/old.svg"
    assert usage[0].size_bytes == 123


def test_build_render_asset_record_uses_storage_and_renderer_metadata() -> None:
    asset = build_render_asset_record(
        asset_uuid="asset-1",
        revision_id=17,
        storage_backend="local",
        stored=StoredFile(
            storage_key="scores/score-1/revisions/revision-1/renders/default/001-asset-1.svg",
            filename="001-asset-1.svg",
            path="/tmp/001-asset-1.svg",
            size_bytes=10,
        ),
        mime_type="image/svg+xml",
        content=b"<svg />",
        execution_manifest_id=19,
        page_number=1,
        profile="default",
        generator="test-renderer",
    )

    assert asset.asset_uuid == "asset-1"
    assert asset.revision_id == 17
    assert asset.kind == RenderAssetKind.RENDERED_PAGE
    assert asset.storage_backend == "local"
    assert asset.storage_key.endswith("/001-asset-1.svg")
    assert asset.mime_type == "image/svg+xml"
    assert asset.size_bytes == 10
    assert asset.execution_manifest_id == 19
    assert asset.page_number == 1
    assert asset.render_profile == "default"
    assert asset.generator == "test-renderer"
    assert asset.generator_version == "1"
    assert len(asset.sha256) == 64
