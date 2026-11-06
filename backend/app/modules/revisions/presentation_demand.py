"""One revision presentation-demand policy, serialized with head/preview writers."""

from enum import Enum

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import (
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    StoredObject,
    ScoreGuestPreviewGrant,
    ScoreDeletionStatus,
)
from app.db.models.score import RevisionSourceFormat
from app.utils.timezone import utc_now_naive


class RevisionPresentationDemand(Enum):
    UNAVAILABLE = "unavailable"
    DEMANDED = "demanded"
    NOT_DEMANDED = "not_demanded"


def lock_presentation_score(db: Session, score_id: int | None) -> Score | None:
    return db.execute(
        select(Score)
        .where(Score.id == score_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def revision_presentation_demand(
    db: Session, score: Score | None, revision_id: int | None, fingerprint: str
) -> RevisionPresentationDemand:
    """Resolve immediately before processing, after Score and outbox locks are held."""
    score_id = score.id if score is not None else None
    revision = db.get(ScoreRevision, revision_id) if revision_id is not None else None
    if (
        score is None
        or score.deletion_status != ScoreDeletionStatus.ACTIVE
        or revision is None
        or revision.score_id != score_id
        or revision.content_hash != fingerprint
    ):
        return RevisionPresentationDemand.UNAVAILABLE
    source = db.execute(
        select(ScoreRevisionSource.id)
        .join(StoredObject, ScoreRevisionSource.stored_object_id == StoredObject.id)
        .where(
            ScoreRevisionSource.revision_id == revision_id,
            ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
            StoredObject.sha256 == fingerprint,
        )
    ).scalar_one_or_none()
    if source is None:
        return RevisionPresentationDemand.UNAVAILABLE
    if score.head_revision_id == revision_id:
        return RevisionPresentationDemand.DEMANDED
    preview = db.execute(
        select(ScoreGuestPreviewGrant.id)
        .where(
            ScoreGuestPreviewGrant.score_id == score_id,
            ScoreGuestPreviewGrant.revision_id == revision_id,
            col(ScoreGuestPreviewGrant.revoked_at).is_(None),
            ScoreGuestPreviewGrant.expires_at > utc_now_naive(),
        )
        .limit(1)
    ).scalar_one_or_none()
    return (
        RevisionPresentationDemand.DEMANDED
        if preview is not None
        else RevisionPresentationDemand.NOT_DEMANDED
    )
