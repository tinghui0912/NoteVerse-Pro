from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.storage_streaming import stream_storage_object
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.db.models.score import RenderAssetKind
from app.modules.score_assets.dependencies import get_score_asset_service
from app.modules.score_assets.schemas import (
    AssetAccessRead,
    ScoreRevisionAssetsRead,
)
from app.modules.score_assets.service import ScoreAssetService


source_router = APIRouter()
render_asset_router = APIRouter()
score_router = APIRouter()


@source_router.get(
    "/{source_id}/download",
    response_class=Response,
    responses=binary_responses("*/*"),
    operation_id="scoreRevisionSourceDownload",
)
async def download_revision_source(
    source_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.source_delivery(db, source_id, user_id)
    return await _stream_asset(delivery, service, attachment=True)


@source_router.get(
    "/{source_id}/access-url",
    operation_id="scoreRevisionSourceAccessUrlGet",
    response_model=AssetAccessRead,
)
async def get_revision_source_access_url(
    source_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.source_access_url(db, source_id, user_id)
    return result


@render_asset_router.get(
    "/{render_asset_id}/download",
    response_class=Response,
    responses=binary_responses("image/*"),
    operation_id="scoreRenderAssetDownload",
)
async def download_render_asset(
    render_asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.render_asset_delivery(db, render_asset_id, user_id)
    return await _stream_asset(delivery, service, attachment=True)


@render_asset_router.get(
    "/{render_asset_id}/view",
    response_class=Response,
    responses=binary_responses("image/*"),
    operation_id="scoreRenderAssetView",
)
async def view_render_asset(
    render_asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.render_asset_delivery(db, render_asset_id, user_id, download=False)
    return await _stream_asset(delivery, service, attachment=False)


@render_asset_router.get(
    "/{render_asset_id}/access-url",
    operation_id="scoreRenderAssetAccessUrlGet",
    response_model=AssetAccessRead,
)
async def get_render_asset_access_url(
    render_asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.render_asset_access_url(db, render_asset_id, user_id)
    return result


@score_router.get(
    "/{score_id}/revision-assets",
    operation_id="scoreRevisionAssetsList",
    response_model=ScoreRevisionAssetsRead,
)
async def list_score_revision_assets(
    score_id: str,
    revision_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_revision_assets(db, score_id, user_id, revision_uuid=revision_id)
    return result


@score_router.get(
    "/{score_id}/render-asset-archive",
    response_class=Response,
    responses=binary_responses("application/zip"),
    operation_id="scoreRenderAssetsArchive",
)
async def archive_score_render_assets(
    score_id: str,
    kind: RenderAssetKind = Query(...),
    revision_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    archive, filename = await service.render_asset_archive(
        db,
        score_id,
        user_id,
        revision_uuid=revision_id,
        kind=kind,
    )
    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _stream_asset(delivery, service: ScoreAssetService, *, attachment: bool):
    return await stream_storage_object(
        storage=service.async_storage,
        storage_key=delivery.storage_key,
        filename=delivery.filename,
        media_type=delivery.media_type,
        attachment=attachment,
    )
