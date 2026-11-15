from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectReadTarget, read_admitted_bytes
from app.modules.storage_objects.writes import (
    ObjectWriteReceipt,
    write_object,
    adopt_written_object,
)

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportArtifact,
    ImportJobUpload,
    ScoreInputAsset,
    ScoreRenderAsset,
    StoredObject,
    Upload,
)
from app.db.models.score import RenderAssetKind, ScoreInputAssetPurpose
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.storage import ObjectStorage


@dataclass(frozen=True)
class PromotedScoreInputUsage:
    asset_uuid: str
    upload_uuid: str
    storage_key: str
    size_bytes: int


@dataclass(frozen=True)
class ReviewThumbnailWrite:
    written: ObjectWriteReceipt
    artifact_uuid: str


def prewrite_review_thumbnail(
    db: Session,
    *,
    storage: ObjectStorage,
    job_id: int,
    score_uuid: str,
    revision_uuid: str,
) -> ReviewThumbnailWrite | None:
    thumbnail = (
        db.execute(
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
        return None
    content = read_admitted_bytes(
        storage, StoredObjectReadTarget.from_object(thumbnail.stored_object)
    )
    artifact_uuid = str(uuid.uuid4())
    extension = "." + thumbnail.filename.rsplit(".", 1)[-1] if "." in thumbnail.filename else ".svg"
    written = write_object(
        db,
        storage,
        key=f"scores/{score_uuid}/revisions/{revision_uuid}/renders/default/001-{artifact_uuid}{extension}",
        content=content,
        content_type=thumbnail.stored_object.content_type,
    )
    return ReviewThumbnailWrite(written, artifact_uuid)


def adopt_review_thumbnail(
    db: Session, prepared: ReviewThumbnailWrite | None, *, revision_id: int
) -> None:
    if prepared is None:
        return
    physical = adopt_written_object(db, prepared.written)
    db.add(
        ScoreRenderAsset(
            asset_uuid=prepared.artifact_uuid,
            revision_id=revision_id,
            kind=RenderAssetKind.RENDERED_PAGE,
            stored_object=physical,
            filename=physical.object_key.rsplit("/", 1)[-1],
            page_number=1,
            render_profile="default",
            generator="review-thumbnail",
            generator_version="1",
        )
    )


def promote_uploads_to_score_inputs(
    db: Session,
    *,
    job_id: int,
    score_id: int,
) -> list[PromotedScoreInputUsage]:
    rows = (
        db.execute(
            select(ImportJobUpload, Upload, StoredObject)
            .join(Upload, ImportJobUpload.upload_id == Upload.id)
            .join(StoredObject, Upload.stored_object_id == StoredObject.id)
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
                storage_key=blob.object_key,
                size_bytes=blob.byte_size,
            )
        )
    return promoted
