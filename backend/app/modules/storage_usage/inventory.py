"""Current accounting ownership, counted per semantic allocation, never per physical object.

PracticeBundle representations and User avatars intentionally have no usage category.
Physical retirement references have a different purpose and do not define this inventory.
"""

from sqlalchemy import select, union_all, literal, func
from sqlalchemy.orm import Session

from app.db.models import (
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ScoreInputAsset,
    Upload,
    ImportArtifact,
    ImportJob,
    PerformanceTake,
    PerformanceTakeManifest,
    StoredObject,
    StorageUsageCategory,
)


def semantic_used_bytes(db: Session, user_id: int) -> dict[StorageUsageCategory, int]:
    score = Score.__table__
    revision = ScoreRevision.__table__
    obj = StoredObject.__table__
    upload = Upload.__table__
    inputs = ScoreInputAsset.__table__
    artifact = ImportArtifact.__table__
    job = ImportJob.__table__
    take = PerformanceTake.__table__
    manifest = PerformanceTakeManifest.__table__

    # Each SELECT emits one row per semantic owner; UNION ALL preserves multiplicity.
    revision_owners = {
        StorageUsageCategory.SOURCE: ScoreRevisionSource.__table__,
        StorageUsageCategory.DERIVED_RENDER: ScoreRenderAsset.__table__,
        StorageUsageCategory.DERIVED_AUDIO: ScorePlaybackAsset.__table__,
    }
    inventory = {
        category: [
            select(obj.c.byte_size)
            .select_from(
                owner.join(obj, owner.c.stored_object_id == obj.c.id)
                .join(revision, owner.c.revision_id == revision.c.id)
                .join(score, revision.c.score_id == score.c.id)
            )
            .where(score.c.owner_user_id == user_id)
        ]
        for category, owner in revision_owners.items()
    }
    inventory[StorageUsageCategory.INPUT_ASSET] = [
        select(obj.c.byte_size)
        .select_from(
            inputs.join(upload, inputs.c.upload_id == upload.c.id)
            .join(obj, upload.c.stored_object_id == obj.c.id)
            .join(score, inputs.c.score_id == score.c.id)
        )
        .where(score.c.owner_user_id == user_id)
    ]
    inventory[StorageUsageCategory.UPLOAD] = [
        select(obj.c.byte_size)
        .select_from(upload.join(obj, upload.c.stored_object_id == obj.c.id))
        .where(
            upload.c.uploader_user_id == user_id,
            ~select(inputs.c.id).where(inputs.c.upload_id == upload.c.id).exists(),
        ),
        select(obj.c.byte_size)
        .select_from(
            take.join(obj, take.c.recording_object_id == obj.c.id).join(
                manifest, take.c.manifest_id == manifest.c.id
            )
        )
        .where(manifest.c.user_id == user_id),
    ]
    inventory[StorageUsageCategory.TEMP_IMPORT] = [
        select(obj.c.byte_size)
        .select_from(
            artifact.join(obj, artifact.c.stored_object_id == obj.c.id).join(
                job, artifact.c.job_id == job.c.id
            )
        )
        .where(job.c.user_id == user_id)
    ]
    if set(inventory) != set(StorageUsageCategory):
        raise RuntimeError("Each storage category requires explicit semantic inventory ownership")
    rows = union_all(
        *[
            query.add_columns(literal(category.value).label("category"))
            for category, queries in inventory.items()
            for query in queries
        ]
    ).subquery()
    totals = dict(
        db.execute(
            select(rows.c.category, func.sum(rows.c.byte_size)).group_by(rows.c.category)
        ).all()
    )
    return {category: int(totals.get(category.value, 0)) for category in StorageUsageCategory}
