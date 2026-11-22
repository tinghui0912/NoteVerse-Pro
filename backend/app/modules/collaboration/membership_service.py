"""Current Score membership commands and collection reads."""

from sqlalchemy.orm import Session
from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import Score, ScoreMembership
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.collaboration.repository import CollaborationRepository
from app.modules.collaboration.read_model import CollaborationReadModel
from app.modules.collaboration.pagination import DEFAULT_PAGE_SIZE
from app.modules.collaboration.schemas import MemberListRead, MemberRead, MemberUpdateRequest
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now


class MembershipService:
    def __init__(
        self,
        repository: CollaborationRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or CollaborationRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.read_model = CollaborationReadModel(self.repository)

    def list_members(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> MemberListRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        memberships, next_cursor = self.repository.memberships(
            db,
            score_id,
            limit=limit,
            cursor=cursor,
        )
        return MemberListRead(
            items=self.read_model.members(db, memberships),
            next_cursor=next_cursor,
        )

    def update_member(
        self,
        db: Session,
        score_uuid: str,
        membership_id: int,
        user_id: int,
        request: MemberUpdateRequest,
    ) -> MemberRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id, lock_score=True
        )
        membership = self._membership_for_score(db, access.score, membership_id)
        if membership.revoked_at is not None:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="membership_id")
        membership.role = request.role
        db.commit()
        db.refresh(membership)
        return self.read_model.member(db, membership)

    def remove_member(self, db: Session, score_uuid: str, membership_id: int, user_id: int) -> None:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id, lock_score=True
        )
        membership = self._membership_for_score(db, access.score, membership_id)
        if membership.user_id == access.score.owner_user_id:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="membership_id")
        if membership.revoked_at is None:
            membership.revoked_at = utc_now()
        db.commit()

    def leave_score(self, db: Session, score_uuid: str, user_id: int) -> None:
        self.access_policy.active_score(db, score_uuid, lock_score=True)
        membership = self.repository.self_membership_for_update(db, score_uuid, user_id)
        # A retry of a completed leave does not grant access or rewrite its timestamp.
        if membership is not None and membership.revoked_at is not None:
            db.commit()
            return
        self.access_policy.authorize_score(db, score_uuid, ScoreAction.LEAVE, user_id=user_id)
        if membership is None:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        membership.revoked_at = utc_now()
        db.commit()

    def _membership_for_score(
        self, db: Session, score: Score, membership_id: int
    ) -> ScoreMembership:
        membership = self.repository.membership_by_id_for_update(db, membership_id)
        if not membership or membership.score_id != score.id:
            raise ResourceNotFoundException(
                "score_membership",
                str(membership_id),
                CustomerErrorCode.MEMBERSHIP_NOT_FOUND,
            )
        return membership
