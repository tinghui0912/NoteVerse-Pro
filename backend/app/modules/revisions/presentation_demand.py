"""One revision presentation-demand policy, serialized with Score head writers."""

from enum import Enum

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    StoredObject,
)
from app.db.models.score import RevisionSourceFormat


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
    """Resolve under the Score lock before claim or final semantic admission."""
    score_id = score.id if score is not None else None
    revision = db.get(ScoreRevision, revision_id) if revision_id is not None else None
    if (
        score is None
        or score.deleted_at is not None
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
    return RevisionPresentationDemand.NOT_DEMANDED


class RevisionPresentationSuperseded(Exception):
    """A generated revision is no longer current presentation demand."""


def admit_generated_revision(
    db: Session, score: Score | None, revision_id: int, fingerprint: str
) -> None:
    demand = revision_presentation_demand(db, score, revision_id, fingerprint)
    if demand == RevisionPresentationDemand.NOT_DEMANDED:
        raise RevisionPresentationSuperseded()
    if demand == RevisionPresentationDemand.UNAVAILABLE:
        from app.core.exceptions import ResourceNotFoundException
        from app.shared.constants import ErrorCode

        raise ResourceNotFoundException("revision_source", code=ErrorCode.FILE_NOT_FOUND)
