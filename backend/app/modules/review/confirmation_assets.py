from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportArtifact,
    ImportJobUpload,
    ScoreInputAsset,
    ScoreRenderAsset,
    StorageBlob,
    Upload,
)
from app.db.models.score import RenderAssetKind, ScoreInputAssetPurpose
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.storage import FileStorage


@dataclass(frozen=True)
class PromotedScoreInputUsage:
    asset_uuid: str
    upload_uuid: str
    storage_key: str
    size_bytes: int


async def copy_review_thumbnail_to_score_revision(
    db: AsyncSession,
    *,
    storage: FileStorage,
    job_id: int,
    score_uuid: str,
    revision_uuid: str,
    revision_id: int,
) -> None:
    thumbnail = (
        await db.execute(
            select(ImportArtifact)
            .where(
                ImportArtifact.job_id == job_id,
                ImportArtifact.kind == ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
            )
            .order_by(col(ImportArtifact.created_at).desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if thumbnail is None:
        return
    content = storage.read_bytes(thumbnail.storage_key)
    artifact_uuid = str(uuid.uuid4())
    extension = "." + thumbnail.filename.rsplit(".", 1)[-1] if "." in thumbnail.filename else ".svg"
    stored = storage.put_bytes(
        key=(
            f"scores/{score_uuid}/revisions/{revision_uuid}/renders/"
            f"default/001-{artifact_uuid}{extension}"
        ),
        content=content,
        content_type=thumbnail.mime_type or "image/svg+xml",
    )
    db.add(
        ScoreRenderAsset(
            asset_uuid=artifact_uuid,
            revision_id=revision_id,
            kind=RenderAssetKind.RENDERED_PAGE,
            storage_backend=storage.backend_name,
            storage_key=stored.storage_key,
            filename=stored.filename,
            mime_type=thumbnail.mime_type or "image/svg+xml",
            size_bytes=stored.size_bytes,
            sha256=hashlib.sha256(content).hexdigest(),
            page_number=1,
            render_profile="default",
            generator="review-thumbnail",
            generator_version="1",
        )
    )


async def promote_uploads_to_score_inputs(
    db: AsyncSession,
    *,
    job_id: int,
    score_id: int,
) -> list[PromotedScoreInputUsage]:
    rows = (
        await db.execute(
            select(ImportJobUpload, Upload, StorageBlob)
            .join(Upload, ImportJobUpload.upload_id == Upload.id)
            .join(StorageBlob, Upload.blob_id == StorageBlob.id)
            .where(ImportJobUpload.job_id == job_id)
            .order_by(col(ImportJobUpload.sort_order).asc(), col(ImportJobUpload.id).asc())
        )
    ).all()
    promoted: list[PromotedScoreInputUsage] = []
    for job_upload, upload, blob in rows:
        asset_uuid = str(uuid.uuid4())
        db.add(
            ScoreInputAsset(
                asset_uuid=asset_uuid,
                score_id=score_id,
                upload_id=require_persisted_id(upload.id, entity="upload"),
                purpose=ScoreInputAssetPurpose.ORIGINAL_UPLOAD,
                page_number=job_upload.page_number,
                sort_order=job_upload.sort_order,
            )
        )
        promoted.append(
            PromotedScoreInputUsage(
                asset_uuid=asset_uuid,
                upload_uuid=upload.upload_uuid,
                storage_key=blob.storage_key,
                size_bytes=blob.size_bytes,
            )
        )
    return promoted
