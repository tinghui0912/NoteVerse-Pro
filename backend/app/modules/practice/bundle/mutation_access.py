"""Lock-bearing live authorization for Practice binding and durable-save mutations."""

from app.modules.score_access.queries import active_score_predicate

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import (
    Score,
    ScoreRevision,
    ScoreMembership,
)
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreRevisionAccessContext, ScoreAccessPolicy
from app.shared.error_codes import CustomerErrorCode


def lock_live_practice_mutation_access(
    db: Session,
    policy: ScoreAccessPolicy,
    *,
    user_id: int,
    score_uuid: str,
    revision_uuid: str,
) -> ScoreRevisionAccessContext:
    """Keep Score, Revision and the selected access facts locked until caller commit.

    Score precedes Revision and Bundle, matching Score deletion and Bundle creation.
    Reauthorization under the selected fact locks fails closed if that authority changed.
    """
    score = (
        db.execute(
            select(Score)
            .where(
                Score.score_uuid == score_uuid,
                active_score_predicate(),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if score is None:
        raise ResourceNotFoundException("score", score_uuid, CustomerErrorCode.SCORE_NOT_FOUND)
    revision = (
        db.execute(
            select(ScoreRevision)
            .where(
                ScoreRevision.score_id == score.id,
                ScoreRevision.revision_uuid == revision_uuid,
            )
            .with_for_update(read=True, key_share=True)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if revision is None:
        raise ResourceNotFoundException(
            "revision", revision_uuid, CustomerErrorCode.REVISION_NOT_FOUND
        )
    access = policy.authorize_revision(
        db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
    )
    authority = (
        access.origin,
        access.membership.id if access.membership else None,
    )
    if access.membership is not None:
        membership = (
            db.execute(
                select(ScoreMembership)
                .where(ScoreMembership.id == access.membership.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if membership is None:
            raise UnauthorizedException(CustomerErrorCode.NO_PRACTICE_ACCESS)
    current = policy.authorize_revision(
        db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
    )
    if authority != (
        current.origin,
        current.membership.id if current.membership else None,
    ):
        raise UnauthorizedException(CustomerErrorCode.NO_PRACTICE_ACCESS)
    return current
