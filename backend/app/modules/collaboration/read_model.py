"""Collection projections hydrate user and Score facts in bounded bulk queries."""

from collections.abc import Sequence
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreInvite, ScoreMembership, User
from app.modules.account.avatar_presentation import avatar_url_for_user
from app.modules.collaboration.invite_lifecycle import effective_invite_status
from app.modules.collaboration.repository import CollaborationRepository
from app.modules.collaboration.schemas import (
    InviteActorRead,
    InviteRead,
    PendingInviteRead,
    MemberRead,
)
from app.shared.constants import ErrorCode
from app.shared.time import utc_now


class CollaborationReadModel:
    def __init__(self, repository: CollaborationRepository | None = None) -> None:
        self.repository = repository or CollaborationRepository()

    @staticmethod
    def actor_read(user: User | None) -> InviteActorRead | None:
        if user is None:
            return None
        return InviteActorRead(
            display_name=user.display_name, email=user.email, avatar_url=avatar_url_for_user(user)
        )

    def actor(self, db: Session, user_id: int | None) -> InviteActorRead | None:
        return (
            self.actor_read(self.repository.users(db, {user_id}).get(user_id))
            if user_id is not None
            else None
        )

    def invites(self, db: Session, invites: Sequence[ScoreInvite]) -> list[InviteRead]:
        user_ids = {row.created_by_user_id for row in invites} | {
            row.terminal_actor_user_id for row in invites if row.terminal_actor_user_id is not None
        }
        users = self.repository.users(db, user_ids)
        now = utc_now()
        return [
            InviteRead(
                invite_id=row.invite_uuid,
                email=row.email,
                role=row.role,
                status=effective_invite_status(row, now=now),
                expires_at=row.expires_at,
                terminal_at=row.terminal_at,
                created_at=row.created_at,
                created_by=self.actor_read(users.get(row.created_by_user_id)),
                terminal_actor=self.actor_read(users.get(row.terminal_actor_user_id))
                if row.terminal_actor_user_id is not None
                else None,
            )
            for row in invites
        ]

    def invite(self, db: Session, invite: ScoreInvite) -> InviteRead:
        return self.invites(db, [invite])[0]

    def pending_invites(
        self, db: Session, invites: Sequence[ScoreInvite]
    ) -> list[PendingInviteRead]:
        scores = self.repository.scores(db, {row.score_id for row in invites})
        users = self.repository.users(db, {row.created_by_user_id for row in invites})
        now = utc_now()
        result = []
        for row in invites:
            score = scores.get(row.score_id)
            if score is None:
                raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
            result.append(
                PendingInviteRead(
                    invite_id=row.invite_uuid,
                    score_id=score.score_uuid,
                    score_display_title=score.display_title,
                    inviter=self.actor_read(users.get(row.created_by_user_id)),
                    email=row.email,
                    role=row.role,
                    status=effective_invite_status(row, now=now),
                    expires_at=row.expires_at,
                    created_at=row.created_at,
                )
            )
        return result

    def pending_invite(self, db: Session, invite: ScoreInvite) -> PendingInviteRead:
        return self.pending_invites(db, [invite])[0]

    def members(self, db: Session, memberships: Sequence[ScoreMembership]) -> list[MemberRead]:
        users = self.repository.users(db, {row.user_id for row in memberships})
        result = []
        for row in memberships:
            user = users.get(row.user_id)
            if user is None:
                raise ResourceNotFoundException("user", str(row.user_id), ErrorCode.USER_NOT_FOUND)
            result.append(
                MemberRead(
                    membership_id=require_persisted_id(row.id, entity="score membership"),
                    display_name=user.display_name,
                    email=user.email,
                    avatar_url=avatar_url_for_user(user),
                    role=row.role,
                    created_at=row.created_at,
                )
            )
        return result

    def member(self, db: Session, membership: ScoreMembership) -> MemberRead:
        return self.members(db, [membership])[0]
