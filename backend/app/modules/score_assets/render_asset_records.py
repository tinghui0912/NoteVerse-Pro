from __future__ import annotations

from dataclasses import dataclass

from app.db.models import ScoreRenderAsset
from app.db.models.score import RenderAssetKind
from app.db.models.stored_object import StoredObject


@dataclass(frozen=True)
class RenderAssetUsage:
    asset_uuid: str
    storage_key: str
    size_bytes: int | None


def rendered_page_object_key(
    *,
    score_uuid: str,
    revision_uuid: str,
    profile: str,
    page: int,
    asset_uuid: str,
    extension: str,
) -> str:
    for component in (score_uuid, revision_uuid, profile, asset_uuid, extension):
        if not component or component in {".", ".."} or "/" in component or "\\" in component:
            raise ValueError("Rendered-page identity must contain safe namespace segments")
    if not extension.startswith("."):
        raise ValueError("Rendered-page extension must start with a dot")
    return (
        f"scores/{score_uuid}/revisions/{revision_uuid}/renders/"
        f"{profile}/{page:03d}-{asset_uuid}{extension}"
    )


def render_asset_usage(assets: list[ScoreRenderAsset]) -> list[RenderAssetUsage]:
    return [
        RenderAssetUsage(
            asset_uuid=item.asset_uuid,
            storage_key=item.stored_object.object_key,
            size_bytes=item.stored_object.byte_size,
        )
        for item in assets
    ]


def build_render_asset_record(
    *,
    asset_uuid: str,
    revision_id: int,
    stored_object: StoredObject,
    execution_manifest_id: int,
    page_number: int,
    profile: str,
    generator: str,
) -> ScoreRenderAsset:
    return ScoreRenderAsset(
        asset_uuid=asset_uuid,
        revision_id=revision_id,
        kind=RenderAssetKind.RENDERED_PAGE,
        stored_object=stored_object,
        filename=stored_object.object_key.rsplit("/", 1)[-1],
        execution_manifest_id=execution_manifest_id,
        page_number=page_number,
        render_profile=profile,
        generator=generator,
        generator_version="1",
    )
