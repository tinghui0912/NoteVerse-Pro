from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import Score, ScoreInvite, ScoreMembership, User
from app.db.models.score_access import InviteTerminalOutcome
from app.modules.collaboration.invite_lifecycle import (
    effective_invite_status,
    require_pending_invite,
)
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.mail.outbox_service import queue_mail
from app.modules.mail.templates.score_invites import build_invite_email, invite_role_label
from app.modules.collaboration.pagination import DEFAULT_PAGE_SIZE
from app.modules.collaboration.repository import CollaborationRepository
from app.modules.collaboration.read_model import CollaborationReadModel
from app.modules.score_access.roles import stronger_role
from app.modules.collaboration.invite_lifecycle import (
    can_user_accept_invite,
    generate_invite_token,
    hash_invite_token,
)
from app.modules.collaboration.schemas import (
    InviteListRead,
    PendingInviteListRead,
    InviteAcceptRead,
    InviteAccessRead,
    InviteCreateRequest,
    InviteCreatedRead,
    InviteRead,
    PendingInviteRead,
)
from app.modules.notifications.service import NotificationService
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import require_utc, utc_now


class InvitationService:
    def __init__(
        self,
        repository: CollaborationRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        notification_service: NotificationService | None = None,
    ) -> None:
        self.repository = repository or CollaborationRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.notification_service = notification_service or NotificationService()
        self.read_model = CollaborationReadModel(self.repository)

    def create_invite(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        request: InviteCreateRequest,
    ) -> InviteCreatedRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id, lock_score=True
        )
        owner = db.get(User, access.score.owner_user_id)
        if owner is None:
            raise ResourceNotFoundException("user", code=CustomerErrorCode.USER_NOT_FOUND)
        if request.email == owner.email.lower():
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="email")
        invite_uuid = str(uuid.uuid4())
        token = generate_invite_token()
        invite = ScoreInvite(
            invite_uuid=invite_uuid,
            score_id=require_persisted_id(access.score.id, entity="score"),
            token_hash=hash_invite_token(token),
            email=request.email,
            role=request.role,
            created_by_user_id=user_id,
            created_at=utc_now(),
            expires_at=require_utc(request.expires_at) if request.expires_at is not None else None,
        )
        db.add(invite)
        db.flush()
        self._queue_invite_email(db, invite, access.score.display_title, token, request.locale)
        db.flush()
        read = self.read_model.invite(db, invite)
        return InviteCreatedRead(**read.model_dump(), token=token)

    def list_invites(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> InviteListRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        invites, next_cursor = self.repository.invites(db, score_id, limit=limit, cursor=cursor)
        return InviteListRead(
            items=self.read_model.invites(db, invites),
            next_cursor=next_cursor,
        )

    def revoke_invite(
        self, db: Session, score_uuid: str, invite_uuid: str, user_id: int
    ) -> InviteRead:
        invite = self._managed_invite(db, score_uuid, invite_uuid, user_id)
        if invite.terminal_outcome != InviteTerminalOutcome.REVOKED:
            now = utc_now()
            require_pending_invite(invite, field="invite_id", now=now)
            invite.terminal_outcome = InviteTerminalOutcome.REVOKED
            invite.terminal_at = now
            invite.terminal_actor_user_id = user_id
        db.flush()
        return self.read_model.invite(db, invite)

    def inspect_invite(self, db: Session, token: str, user_id: int | None) -> InviteAccessRead:
        invite = self._invite_by_token(db, token)
        score = self.repository.active_score(db, invite.score_id)
        if score is None:
            raise ResourceNotFoundException("invite", code=CustomerErrorCode.INVITE_NOT_FOUND)
        user = db.get(User, user_id) if user_id is not None else None
        now = utc_now()
        can_accept = can_user_accept_invite(invite, user, now=now) and (
            user is None or score.owner_user_id != user.id
        )
        return InviteAccessRead(
            invite_id=invite.invite_uuid,
            score_id=score.score_uuid,
            score_display_title=score.display_title,
            inviter=self.read_model.actor(db, invite.created_by_user_id),
            email=invite.email,
            role=invite.role,
            status=effective_invite_status(invite, now=now),
            expires_at=invite.expires_at,
            requires_login=user is None,
            can_accept=can_accept,
        )

    def accept_invite(self, db: Session, token: str, user_id: int) -> InviteAcceptRead:
        invite = self._invite_by_token(db, token)
        return self._accept_invite_record(db, invite, user_id)

    def list_my_pending_invites(
        self,
        db: Session,
        user_id: int,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> PendingInviteListRead:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        invites, next_cursor = self.repository.pending_invites_for_email(
            db,
            user.email.lower(),
            user_id=user_id,
            now=utc_now(),
            limit=limit,
            cursor=cursor,
        )
        return PendingInviteListRead(
            items=self.read_model.pending_invites(db, invites),
            next_cursor=next_cursor,
        )

    def accept_pending_invite(
        self, db: Session, invite_uuid: str, user_id: int
    ) -> InviteAcceptRead:
        invite = self._invite_by_uuid(db, invite_uuid)
        return self._accept_invite_record(db, invite, user_id)

    def decline_pending_invite(
        self, db: Session, invite_uuid: str, user_id: int
    ) -> PendingInviteRead:
        invite = self._invite_by_uuid(db, invite_uuid)
        score, invite = self._lock_invite_parent(db, invite)
        user = self._ensure_invite_target_user(db, invite, user_id)
        now = utc_now()
        require_pending_invite(invite, field="invite_id", now=now)
        invite.terminal_outcome = InviteTerminalOutcome.DECLINED
        invite.terminal_at = now
        invite.terminal_actor_user_id = user_id
        self._notify_invite_response(db, invite=invite, score=score, actor=user, accepted=False)
        read = self.read_model.pending_invite(db, invite)
        db.flush()
        return read

    def _accept_invite_record(
        self, db: Session, invite: ScoreInvite, user_id: int
    ) -> InviteAcceptRead:
        score, invite = self._lock_invite_parent(db, invite)
        user = self._ensure_invite_target_user(db, invite, user_id)
        if score.owner_user_id == user_id:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="email")

        membership = self.repository.membership_for_update(db, invite.score_id, user_id)
        # Waiting on membership may outlast expiry; do not restore access after it.
        now = utc_now()
        require_pending_invite(invite, field="invite_id", now=now)
        if membership:
            if membership.revoked_at is not None:
                membership.revoked_at = None
            membership.role = stronger_role(membership.role, invite.role)
        else:
            membership = ScoreMembership(
                score_id=invite.score_id,
                user_id=user_id,
                role=invite.role,
                created_by_user_id=invite.created_by_user_id,
                created_at=now,
            )
            db.add(membership)
            db.flush()

        invite.terminal_outcome = InviteTerminalOutcome.ACCEPTED
        invite.terminal_actor_user_id = user_id
        invite.terminal_at = now
        self._notify_invite_response(
            db,
            invite=invite,
            score=score,
            actor=user,
            accepted=True,
        )
        db.flush()
        return InviteAcceptRead(
            score_id=score.score_uuid,
            role=membership.role,
            membership_id=require_persisted_id(membership.id, entity="score membership"),
        )

    def _managed_invite(
        self, db: Session, score_uuid: str, invite_uuid: str, user_id: int
    ) -> ScoreInvite:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id, lock_score=True
        )
        invite = self.repository.invite_by_uuid(db, invite_uuid, lock=True)
        if not invite or invite.score_id != access.score.id:
            raise ResourceNotFoundException(
                "invite", invite_uuid, CustomerErrorCode.INVITE_NOT_FOUND
            )
        return invite

    def _invite_by_token(self, db: Session, token: str) -> ScoreInvite:
        invite = self.repository.invite_by_token_hash(db, hash_invite_token(token))
        if not invite:
            raise ResourceNotFoundException("invite", code=CustomerErrorCode.INVITE_NOT_FOUND)
        return invite

    def _invite_by_uuid(self, db: Session, invite_uuid: str) -> ScoreInvite:
        invite = self.repository.invite_by_uuid(db, invite_uuid)
        if not invite:
            raise ResourceNotFoundException(
                "invite", invite_uuid, CustomerErrorCode.INVITE_NOT_FOUND
            )
        return invite

    def _lock_invite_parent(
        self, db: Session, discovered: ScoreInvite
    ) -> tuple[Score, ScoreInvite]:
        # Discovery does not admit a command. Re-read the actor after the parent fence.
        score_id, invite_uuid = discovered.score_id, discovered.invite_uuid
        score = self.repository.active_score(db, score_id, lock=True)
        if score is None:
            raise ResourceNotFoundException("invite", code=CustomerErrorCode.INVITE_NOT_FOUND)
        invite = self.repository.invite_by_uuid(db, invite_uuid, lock=True)
        if invite is None or invite.score_id != score_id:
            raise ResourceNotFoundException("invite", code=CustomerErrorCode.INVITE_NOT_FOUND)
        require_pending_invite(invite, field="invite_id", now=utc_now())
        return score, invite

    def _ensure_invite_target_user(self, db: Session, invite: ScoreInvite, user_id: int) -> User:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS)
        require_pending_invite(invite, field="invite_id", now=utc_now())
        if invite.email != user.email.lower():
            raise ValidationException(CustomerErrorCode.INVITE_EMAIL_MISMATCH, field="email")
        return user

    def _notify_invite_response(
        self,
        db: Session,
        *,
        invite: ScoreInvite,
        score: Score,
        actor: User,
        accepted: bool,
    ) -> None:
        if invite.terminal_at is None:
            raise ValueError("Invite response requires a terminal timestamp")
        self.notification_service.admit_score_invite_response(
            db,
            recipient_user_id=invite.created_by_user_id,
            actor_user_id=require_persisted_id(actor.id, entity="user"),
            accepted=accepted,
            invite_id=invite.invite_uuid,
            score_id=score.score_uuid,
            score_display_title=score.display_title,
            created_at=invite.terminal_at,
        )

    def _queue_invite_email(
        self,
        db: Session,
        invite: ScoreInvite,
        score_display_title: str,
        token: str,
        locale: str,
    ) -> None:
        inviter = self.read_model.actor(db, invite.created_by_user_id)
        inviter_name = (
            inviter.display_name
            if inviter and inviter.display_name
            else inviter.email
            if inviter
            else settings.PROJECT_NAME
        )
        invite_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/invite/{token}"
        role_label = invite_role_label(invite.role, locale)
        email = build_invite_email(
            locale=locale,
            project_name=settings.PROJECT_NAME,
            inviter_name=inviter_name,
            score_display_title=score_display_title,
            role_label=role_label,
            invite_url=invite_url,
        )

        queue_mail(
            db,
            category="score.invite",
            dedupe_key=f"score-invite:{invite.invite_uuid}",
            recipient=invite.email,
            subject=email.subject,
            text_body=email.text_body,
            html_body=email.html_body,
            expires_at=invite.expires_at,
        )
