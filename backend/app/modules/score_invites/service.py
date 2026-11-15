from __future__ import annotations
from app.modules.account.avatar_presentation import avatar_url_for_user

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
from app.db.models.score_access import InviteTerminalOutcome, MembershipRole
from app.modules.score_invites.lifecycle import effective_invite_status, require_pending_invite
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.mail.outbox_service import queue_mail
from app.modules.mail.templates.score_invites import build_invite_email
from app.modules.score_invites.pagination import DEFAULT_PAGE_SIZE
from app.modules.score_invites.repository import ScoreInviteRepository
from app.modules.score_invites.rules import (
    ROLE_RANK,
    can_user_accept_invite,
    generate_invite_token,
    hash_invite_token,
    invite_role_label,
)
from app.modules.score_invites.schemas import (
    InviteListRead,
    MemberListRead,
    PendingInviteListRead,
    InviteAcceptRead,
    InviteAccessRead,
    InviteActorRead,
    InviteCreateRequest,
    InviteCreatedRead,
    InviteRead,
    MemberRead,
    MemberUpdateRequest,
    PendingInviteRead,
)
from app.modules.notifications.service import NotificationService
from app.shared.constants import ErrorCode
from app.shared.time import require_utc, utc_now


class ScoreInviteService:
    def __init__(
        self,
        repository: ScoreInviteRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        notification_service: NotificationService | None = None,
    ) -> None:
        self.repository = repository or ScoreInviteRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.notification_service = notification_service or NotificationService()

    def create_invite(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        request: InviteCreateRequest,
    ) -> InviteCreatedRead:
        access = self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
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
        db.commit()
        db.refresh(invite)
        read = self._invite_read(db, invite)
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
        access = self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        invites, next_cursor = self.repository.invites(db, score_id, limit=limit, cursor=cursor)
        return InviteListRead(
            items=[self._invite_read(db, invite) for invite in invites],
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
        db.commit()
        db.refresh(invite)
        return self._invite_read(db, invite)

    def inspect_invite(self, db: Session, token: str, user_id: int | None) -> InviteAccessRead:
        invite = self._invite_by_token(db, token, allow_inactive=True)
        score = db.get(Score, invite.score_id)
        if not score:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        user = db.get(User, user_id) if user_id is not None else None
        now = utc_now()
        can_accept = can_user_accept_invite(invite, user, now=now)
        return InviteAccessRead(
            invite_id=invite.invite_uuid,
            score_id=score.score_uuid,
            score_display_title=score.display_title,
            inviter=self._actor(db, invite.created_by_user_id),
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
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        invites, next_cursor = self.repository.pending_invites_for_email(
            db,
            user.email.lower(),
            user_id=user_id,
            now=utc_now(),
            limit=limit,
            cursor=cursor,
        )
        return PendingInviteListRead(
            items=[self._pending_invite_read(db, invite) for invite in invites],
            next_cursor=next_cursor,
        )

    def accept_pending_invite(
        self, db: Session, invite_uuid: str, user_id: int
    ) -> InviteAcceptRead:
        invite = self._invite_by_uuid(db, invite_uuid)
        self._ensure_invite_target_user(db, invite, user_id)
        return self._accept_invite_record(db, invite, user_id)

    def decline_pending_invite(
        self, db: Session, invite_uuid: str, user_id: int
    ) -> PendingInviteRead:
        invite = self._invite_by_uuid(db, invite_uuid)
        user = self._ensure_invite_target_user(db, invite, user_id)
        now = utc_now()
        require_pending_invite(invite, field="invite_id", now=now)
        invite.terminal_outcome = InviteTerminalOutcome.DECLINED
        invite.terminal_at = now
        invite.terminal_actor_user_id = user_id
        score = db.get(Score, invite.score_id)
        if score:
            self._notify_invite_response(
                db,
                invite=invite,
                score=score,
                actor=user,
                accepted=False,
            )
        db.commit()
        db.refresh(invite)
        return self._pending_invite_read(db, invite)

    def _accept_invite_record(
        self, db: Session, invite: ScoreInvite, user_id: int
    ) -> InviteAcceptRead:
        user = self._ensure_invite_target_user(db, invite, user_id)
        score = db.get(Score, invite.score_id)
        if not score:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        if score.owner_user_id == user_id:
            now = utc_now()
            require_pending_invite(invite, field="invite_id", now=now)
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
            db.commit()
            db.refresh(invite)
            return InviteAcceptRead(
                score_id=score.score_uuid,
                role=MembershipRole.EDITOR,
                membership_id=None,
            )

        membership = self.repository.membership_for_update(db, invite.score_id, user_id)
        # Waiting on membership may outlast expiry; do not restore access after it.
        now = utc_now()
        require_pending_invite(invite, field="invite_id", now=now)
        if membership:
            if membership.revoked_at is not None:
                membership.revoked_at = None
            if ROLE_RANK[invite.role] > ROLE_RANK[membership.role]:
                membership.role = invite.role
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
        db.commit()
        db.refresh(membership)
        db.refresh(invite)
        return InviteAcceptRead(
            score_id=score.score_uuid,
            role=membership.role,
            membership_id=require_persisted_id(membership.id, entity="score membership"),
        )

    def list_members(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> MemberListRead:
        access = self.access_policy.authorize(
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
            items=[self._member_read(db, membership) for membership in memberships],
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
        access = self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        membership = self._membership_for_score(db, access.score, membership_id)
        if membership.revoked_at is not None:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="membership_id")
        membership.role = request.role
        db.commit()
        db.refresh(membership)
        return self._member_read(db, membership)

    def remove_member(
        self, db: Session, score_uuid: str, membership_id: int, user_id: int
    ) -> MemberRead:
        access = self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        membership = self._membership_for_score(db, access.score, membership_id)
        if membership.user_id == access.score.owner_user_id:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="membership_id")
        if membership.revoked_at is None:
            membership.revoked_at = utc_now()
        db.commit()
        db.refresh(membership)
        return self._member_read(db, membership)

    def leave_score(self, db: Session, score_uuid: str, user_id: int) -> None:
        membership = self.repository.self_membership_for_update(db, score_uuid, user_id)
        # A retry of a completed leave does not grant access or rewrite its timestamp.
        if membership is not None and membership.revoked_at is not None:
            db.commit()
            return
        self.access_policy.authorize(db, score_uuid, ScoreAction.LEAVE, user_id=user_id)
        if membership is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        membership.revoked_at = utc_now()
        db.commit()

    def _managed_invite(
        self, db: Session, score_uuid: str, invite_uuid: str, user_id: int
    ) -> ScoreInvite:
        access = self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        invite = self.repository.invite_by_uuid(db, invite_uuid, lock=True)
        if not invite or invite.score_id != access.score.id:
            raise ResourceNotFoundException("invite", invite_uuid, ErrorCode.INVITE_NOT_FOUND)
        return invite

    def _invite_by_token(
        self, db: Session, token: str, *, allow_inactive: bool = False
    ) -> ScoreInvite:
        invite = self.repository.invite_by_token_hash(
            db, hash_invite_token(token), lock=not allow_inactive
        )
        if not invite:
            raise ResourceNotFoundException("invite", code=ErrorCode.INVITE_NOT_FOUND)
        if allow_inactive:
            return invite
        require_pending_invite(invite, field="token", now=utc_now())
        return invite

    def _invite_by_uuid(self, db: Session, invite_uuid: str) -> ScoreInvite:
        invite = self.repository.invite_by_uuid(db, invite_uuid, lock=True)
        if not invite:
            raise ResourceNotFoundException("invite", invite_uuid, ErrorCode.INVITE_NOT_FOUND)
        require_pending_invite(invite, field="invite_id", now=utc_now())
        return invite

    def _ensure_invite_target_user(self, db: Session, invite: ScoreInvite, user_id: int) -> User:
        user = db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        require_pending_invite(invite, field="invite_id", now=utc_now())
        if invite.email != user.email.lower():
            raise ValidationException(ErrorCode.INVITE_EMAIL_MISMATCH, field="email")
        return user

    def _membership_for_score(
        self, db: Session, score: Score, membership_id: int
    ) -> ScoreMembership:
        membership = self.repository.membership_by_id_for_update(db, membership_id)
        if not membership or membership.score_id != score.id:
            raise ResourceNotFoundException(
                "score_membership",
                str(membership_id),
                ErrorCode.MEMBERSHIP_NOT_FOUND,
            )
        return membership

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

    def _invite_read(self, db: Session, invite: ScoreInvite) -> InviteRead:
        return InviteRead(
            invite_id=invite.invite_uuid,
            email=invite.email,
            role=invite.role,
            status=effective_invite_status(invite, now=utc_now()),
            expires_at=invite.expires_at,
            terminal_at=invite.terminal_at,
            created_at=invite.created_at,
            created_by=self._actor(db, invite.created_by_user_id),
            terminal_actor=self._actor(db, invite.terminal_actor_user_id),
        )

    def _pending_invite_read(self, db: Session, invite: ScoreInvite) -> PendingInviteRead:
        score = db.get(Score, invite.score_id)
        if not score:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        return PendingInviteRead(
            invite_id=invite.invite_uuid,
            score_id=score.score_uuid,
            score_display_title=score.display_title,
            inviter=self._actor(db, invite.created_by_user_id),
            email=invite.email,
            role=invite.role,
            status=effective_invite_status(invite, now=utc_now()),
            expires_at=invite.expires_at,
            created_at=invite.created_at,
        )

    def _member_read(self, db: Session, membership: ScoreMembership) -> MemberRead:
        user = db.get(User, membership.user_id)
        if not user:
            raise ResourceNotFoundException(
                "user", str(membership.user_id), ErrorCode.USER_NOT_FOUND
            )
        return MemberRead(
            membership_id=require_persisted_id(membership.id, entity="score membership"),
            display_name=user.display_name,
            email=user.email,
            avatar_url=avatar_url_for_user(user),
            role=membership.role,
            created_at=membership.created_at,
            revoked_at=membership.revoked_at,
        )

    def _actor(self, db: Session, user_id: int | None) -> InviteActorRead | None:
        if user_id is None:
            return None
        user = db.get(User, user_id)
        if not user:
            return None
        return InviteActorRead(
            display_name=user.display_name,
            email=user.email,
            avatar_url=avatar_url_for_user(user),
        )

    def _queue_invite_email(
        self,
        db: Session,
        invite: ScoreInvite,
        score_display_title: str,
        token: str,
        locale: str,
    ) -> None:
        if not invite.email:
            return

        inviter = self._actor(db, invite.created_by_user_id)
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
