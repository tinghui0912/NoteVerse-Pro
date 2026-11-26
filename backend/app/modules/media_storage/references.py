"""The real semantic foreign keys are the repo-wide ownership authority."""

from sqlalchemy import or_, select

from app.db.models import (
    Upload,
    PerformanceTake,
    ImportArtifact,
    ScoreRevisionSource,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    PracticeBundleRecord,
    User,
)

SEMANTIC_REFERENCES = (
    Upload.__table__.c.stored_object_id,
    PerformanceTake.__table__.c.recording_object_id,
    ImportArtifact.__table__.c.stored_object_id,
    ScoreRevisionSource.__table__.c.stored_object_id,
    ScoreRenderAsset.__table__.c.stored_object_id,
    ScorePlaybackAsset.__table__.c.stored_object_id,
    PracticeBundleRecord.__table__.c.prepared_musicxml_object_id,
    PracticeBundleRecord.__table__.c.artifact_object_id,
    User.__table__.c.avatar_object_id,
)


def semantic_references_statement(object_id: int):
    return select(
        or_(*(select(column).where(column == object_id).exists() for column in SEMANTIC_REFERENCES))
    )


def stored_object_has_semantic_references(db, object_id: int) -> bool:
    return bool(db.scalar(semantic_references_statement(object_id)))
