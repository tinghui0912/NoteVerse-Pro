from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.db.models.score import ArtifactKind
from app.modules.artifacts.dependencies import get_artifact_service, get_revision_render_service
from app.modules.artifacts.render_service import RevisionRenderService
from app.modules.artifacts.schemas import ArtifactAccessRead, ArtifactDiagnosticsRead, ArtifactRead
from app.modules.artifacts.service import ArtifactService
from app.shared.responses import APIResponse, success_response

router = APIRouter()
score_artifact_router = APIRouter()


@router.get("/{artifact_id}/download")
async def download_artifact(
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ArtifactService = Depends(get_artifact_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    delivery = await service.delivery(db, artifact_id, user_id)
    if delivery.redirect_url:
        return RedirectResponse(delivery.redirect_url, status_code=302)
    return FileResponse(
        delivery.path or "",
        filename=delivery.filename,
        media_type=delivery.media_type,
    )


@router.get("/{artifact_id}/access-url", response_model=APIResponse[ArtifactAccessRead])
async def get_artifact_access_url(
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ArtifactService = Depends(get_artifact_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.access_url(db, artifact_id, user_id)
    return success_response(data=result)


@score_artifact_router.get("/{score_id}/artifacts", response_model=APIResponse[list[ArtifactRead]])
async def list_score_artifacts(
    score_id: str,
    revision_id: str | None = Query(default=None),
    kind: ArtifactKind | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ArtifactService = Depends(get_artifact_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list(
        db, score_id, user_id, revision_uuid=revision_id, kind=kind
    )
    return success_response(data=result)


@score_artifact_router.post("/{score_id}/revisions/{revision_id}/render", response_model=APIResponse[list[ArtifactRead]])
async def render_revision(
    score_id: str,
    revision_id: str,
    profile: str = Query(default="default", min_length=1, max_length=128),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: RevisionRenderService = Depends(get_revision_render_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.render(
        db, score_id, revision_id, user_id, profile=profile
    )
    return success_response(data=result)


@score_artifact_router.get("/{score_id}/artifact-archive")
async def archive_score_artifacts(
    score_id: str,
    kind: ArtifactKind = Query(...),
    revision_id: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ArtifactService = Depends(get_artifact_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    archive, filename = await service.archive(
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


@score_artifact_router.get("/{score_id}/revisions/{revision_id}/artifact-diagnostics", response_model=APIResponse[ArtifactDiagnosticsRead])
async def diagnose_revision_artifacts(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ArtifactService = Depends(get_artifact_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.diagnostics(db, score_id, revision_id, user_id)
    return success_response(data=result)


@score_artifact_router.delete("/{score_id}/revisions/{revision_id}/missing-artifacts", response_model=APIResponse[dict[str, int]])
async def cleanup_missing_revision_artifacts(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ArtifactService = Depends(get_artifact_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    removed = await service.cleanup_missing_derived(db, score_id, revision_id, user_id)
    return success_response(data={"removed": removed})

