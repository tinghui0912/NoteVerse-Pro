from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportJobUpload,
    ScoreInputAsset,
    StoredObject,
    Upload,
)
from app.db.models.score import ScoreInputAssetPurpose


@dataclass(frozen=True)
class PromotedScoreInputUsage:
    asset_uuid: str
    upload_uuid: str
    storage_key: str
    size_bytes: int


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
