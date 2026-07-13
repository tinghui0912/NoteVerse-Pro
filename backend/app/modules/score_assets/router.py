from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.db.models.score import RenderAssetKind
from app.modules.score_assets.dependencies import get_score_asset_service
from app.modules.score_assets.schemas import (
    AssetAccessRead,
    RenderAssetDiagnosticsRead,
    ScoreRevisionAssetsRead,
)
from app.modules.score_assets.service import ScoreAssetService
from app.shared.responses import APIResponse, success_response

source_router = APIRouter()
render_asset_router = APIRouter()
score_router = APIRouter()


@source_router.get("/{source_id}/download")
async def download_revision_source(
    source_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.source_delivery(db, source_id, user_id)
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@source_router.get("/{source_id}/access-url", response_model=APIResponse[AssetAccessRead])
async def get_revision_source_access_url(
    source_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.source_access_url(db, source_id, user_id)
    return success_response(data=result)


@render_asset_router.get("/{render_asset_id}/download")
async def download_render_asset(
    render_asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.render_asset_delivery(db, render_asset_id, user_id)
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@render_asset_router.get("/{render_asset_id}/access-url", response_model=APIResponse[AssetAccessRead])
async def get_render_asset_access_url(
    render_asset_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.render_asset_access_url(db, render_asset_id, user_id)
    return success_response(data=result)


@score_router.get("/{score_id}/revision-assets", response_model=APIResponse[ScoreRevisionAssetsRead])
async def list_score_revision_assets(
    score_id: str,
    revision_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_revision_assets(
        db, score_id, user_id, revision_uuid=revision_id
    )
    return success_response(data=result)


@score_router.get("/{score_id}/render-asset-archive")
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


@score_router.get(
    "/{score_id}/revisions/{revision_id}/render-asset-diagnostics",
    response_model=APIResponse[RenderAssetDiagnosticsRead],
)
async def diagnose_revision_render_assets(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.diagnostics(db, score_id, revision_id, user_id)
    return success_response(data=result)


@score_router.delete(
    "/{score_id}/revisions/{revision_id}/missing-render-assets",
    response_model=APIResponse[dict[str, int]],
)
async def cleanup_missing_revision_render_assets(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreAssetService = Depends(get_score_asset_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    removed = await service.cleanup_missing_render_assets(
        db, score_id, revision_id, user_id
    )
    return success_response(data={"removed": removed})
