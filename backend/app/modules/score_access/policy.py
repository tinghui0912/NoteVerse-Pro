from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import (
    Score,
    ScoreMembership,
    ScoreRevision,
)
from app.db.models.score_access import (
    AccessOrigin,
)
from app.modules.account.resource_admission import lock_active_resource_user
from app.modules.score_access.actions import ScoreAction, semantics_for
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_access.roles import membership_capabilities, owner_capabilities
from app.modules.score_access.queries import active_score_predicate, active_membership_predicate
from app.shared.error_codes import CustomerErrorCode


@dataclass(frozen=True)
class ScoreAccessContext:
    score: Score
    origin: AccessOrigin
    capabilities: ScoreCapabilities
    membership: ScoreMembership | None = None


@dataclass(frozen=True)
class ScoreRevisionAccessContext:
    score: Score
    revision: ScoreRevision
    origin: AccessOrigin
    capabilities: ScoreCapabilities
    membership: ScoreMembership | None = None


class ScoreAccessPolicy:
    def resolve_score(
        self,
        db: Session,
        score_uuid: str,
        *,
        user_id: int | None = None,
        lock_score: bool = False,
    ) -> ScoreAccessContext:
        score = self.active_score(db, score_uuid, lock_score=lock_score)
        if lock_score and user_id is not None:
            lock_active_resource_user(db, user_id)
        if user_id == score.owner_user_id:
            return ScoreAccessContext(score, AccessOrigin.OWNER, owner_capabilities())
        if user_id is not None:
            membership = db.scalar(
                select(ScoreMembership).where(
                    ScoreMembership.score_id == score.id, active_membership_predicate(user_id)
                )
            )
            if membership is not None:
                return ScoreAccessContext(
                    score,
                    AccessOrigin.MEMBERSHIP,
                    membership_capabilities(membership.role),
                    membership,
                )
        raise UnauthorizedException(CustomerErrorCode.NO_ACCESS, {"score_id": score_uuid})

    def authorize_score(
        self,
        db: Session,
        score_uuid: str,
        action: ScoreAction,
        *,
        user_id: int | None = None,
        lock_score: bool = False,
    ) -> ScoreAccessContext:
        access = self.resolve_score(db, score_uuid, user_id=user_id, lock_score=lock_score)
        self._require_action(access, score_uuid, action)
        return access

    def active_score(self, db: Session, score_uuid: str, *, lock_score: bool = False) -> Score:
        """Resolve the live parent; command admission holds its lifecycle lock."""
        query = select(Score).where(Score.score_uuid == score_uuid, active_score_predicate())
        if lock_score:
            query = query.with_for_update().execution_options(
                populate_existing=True, autoflush=False
            )
        score = db.scalar(query)
        if score is None:
            raise ResourceNotFoundException("score", score_uuid, CustomerErrorCode.SCORE_NOT_FOUND)
        return score

    def resolve_revision(
        self,
        db: Session,
        score_uuid: str,
        *,
        user_id: int | None = None,
        revision_uuid: str | None = None,
    ) -> ScoreRevisionAccessContext:
        access = self.resolve_score(db, score_uuid, user_id=user_id)
        revision = self._revision(db, access.score, revision_uuid)
        return ScoreRevisionAccessContext(
            access.score, revision, access.origin, access.capabilities, access.membership
        )

    def authorize_revision(
        self,
        db: Session,
        score_uuid: str,
        action: ScoreAction,
        *,
        user_id: int | None = None,
        revision_uuid: str | None = None,
    ) -> ScoreRevisionAccessContext:
        access = self.resolve_revision(db, score_uuid, user_id=user_id, revision_uuid=revision_uuid)
        self._require_action(access, score_uuid, action)
        return access

    @staticmethod
    def _require_action(
        access: ScoreAccessContext | ScoreRevisionAccessContext,
        score_uuid: str,
        action: ScoreAction,
    ) -> None:
        spec = semantics_for(action)
        allowed = getattr(access.capabilities, spec.capability)
        if not allowed:
            raise UnauthorizedException(
                spec.denial_code, {"score_id": score_uuid, "action": action.value}
            )

    def _revision(self, db: Session, score: Score, revision_uuid: str | None) -> ScoreRevision:
        if revision_uuid:
            revision = (
                db.execute(
                    select(ScoreRevision).where(
                        ScoreRevision.revision_uuid == revision_uuid,
                        ScoreRevision.score_id == score.id,
                    )
                )
            ).scalar_one_or_none()
        else:
            revision = db.get(ScoreRevision, score.head_revision_id)
        if not revision or revision.score_id != score.id:
            raise ResourceNotFoundException(
                "revision", revision_uuid or "head", CustomerErrorCode.REVISION_NOT_FOUND
            )
        return revision
