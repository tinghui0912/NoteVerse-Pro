from __future__ import annotations

from dataclasses import dataclass
import enum

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
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_access.roles import membership_capabilities, owner_capabilities
from app.modules.score_access.queries import active_score_predicate, active_membership_predicate
from app.shared.error_codes import CustomerErrorCode


class ScoreAction(str, enum.Enum):
    VIEW = "VIEW"
    EDIT = "EDIT"
    DELETE = "DELETE"
    LEAVE = "LEAVE"
    MANAGE_GUEST_PREVIEWS = "MANAGE_GUEST_PREVIEWS"
    MANAGE_MEMBERS = "MANAGE_MEMBERS"
    DOWNLOAD = "DOWNLOAD"
    PRACTICE = "PRACTICE"


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
        self, db: Session, score_uuid: str, *, user_id: int | None = None
    ) -> ScoreAccessContext:
        score = db.scalar(
            select(Score).where(Score.score_uuid == score_uuid, active_score_predicate())
        )
        if score is None:
            raise ResourceNotFoundException("score", score_uuid, CustomerErrorCode.SCORE_NOT_FOUND)
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
        self, db: Session, score_uuid: str, action: ScoreAction, *, user_id: int | None = None
    ) -> ScoreAccessContext:
        access = self.resolve_score(db, score_uuid, user_id=user_id)
        self._require_action(access, score_uuid, action)
        return access

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
        allowed = {
            ScoreAction.VIEW: access.capabilities.can_view,
            ScoreAction.EDIT: access.capabilities.can_edit,
            ScoreAction.DELETE: access.capabilities.can_delete,
            ScoreAction.LEAVE: access.capabilities.can_leave,
            ScoreAction.MANAGE_GUEST_PREVIEWS: access.capabilities.can_manage_guest_previews,
            ScoreAction.MANAGE_MEMBERS: access.capabilities.can_manage_members,
            ScoreAction.DOWNLOAD: access.capabilities.can_download,
            ScoreAction.PRACTICE: access.capabilities.can_practice,
        }[action]
        if not allowed:
            raise UnauthorizedException(
                _denial_code(action), {"score_id": score_uuid, "action": action.value}
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


def _denial_code(action: ScoreAction) -> CustomerErrorCode:
    if action == ScoreAction.EDIT:
        return CustomerErrorCode.NO_EDIT_ACCESS
    if action == ScoreAction.DELETE:
        return CustomerErrorCode.NO_DELETE_ACCESS
    if action == ScoreAction.MANAGE_GUEST_PREVIEWS:
        return CustomerErrorCode.NO_GUEST_PREVIEW_ACCESS
    if action == ScoreAction.DOWNLOAD:
        return CustomerErrorCode.NO_DOWNLOAD_ACCESS
    if action == ScoreAction.PRACTICE:
        return CustomerErrorCode.NO_PRACTICE_ACCESS
    return CustomerErrorCode.NO_ACCESS
