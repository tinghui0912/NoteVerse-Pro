"""Lock-bearing live authorization for a new durable save admission."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import (
    Score,
    ScoreDeletionStatus,
    ScoreRevision,
    ScoreMembership,
    ScoreShareGrant,
    ShareGrantRedemption,
)
from app.modules.score_access.policy import ScoreAccessContext, ScoreAccessPolicy, ScoreAction
from app.shared.constants import ErrorCode


async def lock_live_save_access(
    db: AsyncSession,
    policy: ScoreAccessPolicy,
    *,
    user_id: int,
    score_uuid: str,
    revision_uuid: str,
) -> ScoreAccessContext:
    """Keep Score, Revision and the selected access facts locked until caller commit.

    Score precedes Revision and Source, matching Score deletion and Source creation.
    Reauthorization under the selected fact locks fails closed if that authority changed.
    """
    score = (
        await db.execute(
            select(Score)
            .where(
                Score.score_uuid == score_uuid,
                Score.deletion_status == ScoreDeletionStatus.ACTIVE,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if score is None:
        raise ResourceNotFoundException("score", score_uuid, ErrorCode.SCORE_NOT_FOUND)
    revision = (
        await db.execute(
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
        raise ResourceNotFoundException("revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND)
    access = await policy.authorize(
        db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
    )
    authority = (
        access.origin,
        access.membership.id if access.membership else None,
        access.grant.id if access.grant else None,
    )
    if access.membership is not None:
        membership = (
            await db.execute(
                select(ScoreMembership)
                .where(ScoreMembership.id == access.membership.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if membership is None:
            raise UnauthorizedException(ErrorCode.NO_PRACTICE_ACCESS)
    if access.grant is not None:
        grant = (
            await db.execute(
                select(ScoreShareGrant)
                .where(ScoreShareGrant.id == access.grant.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if grant is None:
            raise UnauthorizedException(ErrorCode.NO_PRACTICE_ACCESS)
        redemption = (
            await db.execute(
                select(ShareGrantRedemption)
                .where(
                    ShareGrantRedemption.grant_id == access.grant.id,
                    ShareGrantRedemption.user_id == user_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if redemption is None:
            raise UnauthorizedException(ErrorCode.NO_PRACTICE_ACCESS)
    current = await policy.authorize(
        db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
    )
    if authority != (
        current.origin,
        current.membership.id if current.membership else None,
        current.grant.id if current.grant else None,
    ):
        raise UnauthorizedException(ErrorCode.NO_PRACTICE_ACCESS)
    return current
