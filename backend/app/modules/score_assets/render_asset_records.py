from __future__ import annotations
from app.modules.storage_objects.facts import StoredObjectFacts
from app.modules.storage_objects.persistence import object_to_row

import hashlib
from dataclasses import dataclass

from app.db.models import ScoreRenderAsset
from app.db.models.score import RenderAssetKind
from app.storage import ObjectWriteResult


@dataclass(frozen=True)
class RenderAssetUsage:
    asset_uuid: str
    storage_key: str
    size_bytes: int | None


def render_storage_key(
    *,
    score_uuid: str,
    revision_uuid: str,
    profile: str,
    page: int,
    asset_uuid: str,
    extension: str,
) -> str:
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
    stored: ObjectWriteResult,
    mime_type: str,
    content: bytes,
    execution_manifest_id: int,
    page_number: int,
    profile: str,
    generator: str,
) -> ScoreRenderAsset:
    return ScoreRenderAsset(
        asset_uuid=asset_uuid,
        revision_id=revision_id,
        kind=RenderAssetKind.RENDERED_PAGE,
        stored_object=object_to_row(
            StoredObjectFacts(
                object_key=stored.object_key,
                content_type=mime_type,
                byte_size=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
            )
        ),
        filename=stored.object_key.rsplit("/", 1)[-1],
        execution_manifest_id=execution_manifest_id,
        page_number=page_number,
        render_profile=profile,
        generator=generator,
        generator_version="1",
    )
