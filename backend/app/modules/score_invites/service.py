from __future__ import annotations

import hashlib
import secrets
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import Score, ScoreInvite, ScoreMembership, User
from app.db.models.score_access import InviteStatus, MembershipRole
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_invites.email_templates import build_invite_email
from app.modules.mail.outbox_service import queue_mail
from app.modules.score_invites.repository import ScoreInviteRepository
from app.modules.score_invites.schemas import (
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
from app.modules.notifications.service import NotificationService, NotificationTypes
from app.shared.constants import ErrorCode
from app.utils.timezone import to_utc_naive, utc_now_naive


ROLE_RANK: dict[MembershipRole, int] = {
    MembershipRole.VIEWER: 1,
    MembershipRole.EDITOR: 2,
}

INVITE_TOKEN_BYTES = 32


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_invite_token() -> str:
    return secrets.token_urlsafe(INVITE_TOKEN_BYTES)


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

    async def create_invite(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        request: InviteCreateRequest,
    ) -> InviteCreatedRead:
        access = await self.access_policy.authorize(
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
            status=InviteStatus.PENDING,
            created_by_user_id=user_id,
            created_at=utc_now_naive(),
            expires_at=to_utc_naive(request.expires_at),
        )
        db.add(invite)
        await db.flush()
        await self._queue_invite_email(db, invite, access.score.title, token, request.locale)
        await db.commit()
        await db.refresh(invite)
        read = await self._invite_read(db, invite)
        return InviteCreatedRead(**read.model_dump(), token=token)

    async def list_invites(
        self, db: AsyncSession, score_uuid: str, user_id: int
    ) -> list[InviteRead]:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        return [
            await self._invite_read(db, invite)
            for invite in await self.repository.invites(db, score_id)
        ]

    async def revoke_invite(
        self, db: AsyncSession, score_uuid: str, invite_uuid: str, user_id: int
    ) -> InviteRead:
        invite = await self._managed_invite(db, score_uuid, invite_uuid, user_id)
        if invite.status == InviteStatus.PENDING:
            invite.status = InviteStatus.REVOKED
            invite.revoked_at = utc_now_naive()
        await db.commit()
        await db.refresh(invite)
        return await self._invite_read(db, invite)

    async def delete_invite(
        self, db: AsyncSession, score_uuid: str, invite_uuid: str, user_id: int
    ) -> None:
        invite = await self._managed_invite(db, score_uuid, invite_uuid, user_id)
        await db.delete(invite)
        await db.commit()

    async def inspect_invite(
        self, db: AsyncSession, token: str, user_id: int | None
    ) -> InviteAccessRead:
        invite = await self._invite_by_token(db, token, allow_inactive=True)
        score = await db.get(Score, invite.score_id)
        if not score:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        user = await db.get(User, user_id) if user_id is not None else None
        can_accept = self._can_user_accept(invite, user)
        return InviteAccessRead(
            invite_id=invite.invite_uuid,
            score_id=score.score_uuid,
            score_title=score.title,
            inviter=await self._actor(db, invite.created_by_user_id),
            email=invite.email,
            role=invite.role,
            status=self._display_status(invite),
            expires_at=invite.expires_at,
            requires_login=user is None,
            can_accept=can_accept,
        )

    async def accept_invite(self, db: AsyncSession, token: str, user_id: int) -> InviteAcceptRead:
        invite = await self._invite_by_token(db, token)
        return await self._accept_invite_record(db, invite, user_id)

    async def list_my_pending_invites(
        self, db: AsyncSession, user_id: int
    ) -> list[PendingInviteRead]:
        user = await db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        invites = await self.repository.pending_invites_for_email(db, user.email.lower())
        active_invites: list[PendingInviteRead] = []
        for invite in invites:
            if self._display_status(invite) == InviteStatus.PENDING:
                active_invites.append(await self._pending_invite_read(db, invite))
        return active_invites

    async def accept_pending_invite(
        self, db: AsyncSession, invite_uuid: str, user_id: int
    ) -> InviteAcceptRead:
        invite = await self._invite_by_uuid(db, invite_uuid)
        await self._ensure_invite_target_user(db, invite, user_id)
        return await self._accept_invite_record(db, invite, user_id)

    async def decline_pending_invite(
        self, db: AsyncSession, invite_uuid: str, user_id: int
    ) -> PendingInviteRead:
        invite = await self._invite_by_uuid(db, invite_uuid)
        user = await self._ensure_invite_target_user(db, invite, user_id)
        invite.status = InviteStatus.DECLINED
        invite.declined_at = utc_now_naive()
        await db.commit()
        await db.refresh(invite)
        score = await db.get(Score, invite.score_id)
        if score:
            await self._notify_invite_response(
                db,
                invite=invite,
                score=score,
                actor=user,
                notification_type=NotificationTypes.SCORE_INVITE_DECLINED,
                title="Invite declined",
                action="declined",
            )
        return await self._pending_invite_read(db, invite)

    async def _accept_invite_record(
        self, db: AsyncSession, invite: ScoreInvite, user_id: int
    ) -> InviteAcceptRead:
        user = await db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        if not self._can_user_accept(invite, user):
            raise ValidationException(ErrorCode.INVITE_EMAIL_MISMATCH, field="email")
        score = await db.get(Score, invite.score_id)
        if not score:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        if score.owner_user_id == user_id:
            invite.status = InviteStatus.ACCEPTED
            invite.accepted_by_user_id = user_id
            invite.accepted_at = utc_now_naive()
            await db.commit()
            await db.refresh(invite)
            await self._notify_invite_response(
                db,
                invite=invite,
                score=score,
                actor=user,
                notification_type=NotificationTypes.SCORE_INVITE_ACCEPTED,
                title="Invite accepted",
                action="accepted",
            )
            return InviteAcceptRead(
                score_id=score.score_uuid,
                role=MembershipRole.EDITOR,
                membership_id=None,
            )

        membership = await self.repository.membership(db, invite.score_id, user_id)
        now = utc_now_naive()
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
            await db.flush()

        invite.status = InviteStatus.ACCEPTED
        invite.accepted_by_user_id = user_id
        invite.accepted_at = now
        await db.commit()
        await db.refresh(membership)
        await db.refresh(invite)
        await self._notify_invite_response(
            db,
            invite=invite,
            score=score,
            actor=user,
            notification_type=NotificationTypes.SCORE_INVITE_ACCEPTED,
            title="Invite accepted",
            action="accepted",
        )
        return InviteAcceptRead(
            score_id=score.score_uuid,
            role=membership.role,
            membership_id=require_persisted_id(membership.id, entity="score membership"),
        )

    async def list_members(
        self, db: AsyncSession, score_uuid: str, user_id: int
    ) -> list[MemberRead]:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        return [
            await self._member_read(db, membership)
            for membership in await self.repository.memberships(db, score_id)
        ]

    async def update_member(
        self,
        db: AsyncSession,
        score_uuid: str,
        membership_id: int,
        user_id: int,
        request: MemberUpdateRequest,
    ) -> MemberRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        membership = await self._membership_for_score(db, access.score, membership_id)
        membership.role = request.role
        if membership.revoked_at is not None:
            membership.revoked_at = None
        await db.commit()
        await db.refresh(membership)
        return await self._member_read(db, membership)

    async def remove_member(
        self, db: AsyncSession, score_uuid: str, membership_id: int, user_id: int
    ) -> MemberRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        membership = await self._membership_for_score(db, access.score, membership_id)
        if membership.user_id == access.score.owner_user_id:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="membership_id")
        membership.revoked_at = utc_now_naive()
        await db.commit()
        await db.refresh(membership)
        return await self._member_read(db, membership)

    async def _managed_invite(
        self, db: AsyncSession, score_uuid: str, invite_uuid: str, user_id: int
    ) -> ScoreInvite:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_MEMBERS, user_id=user_id
        )
        invite = await self.repository.invite_by_uuid(db, invite_uuid)
        if not invite or invite.score_id != access.score.id:
            raise ResourceNotFoundException("invite", invite_uuid, ErrorCode.INVITE_NOT_FOUND)
        return invite

    async def _invite_by_token(
        self, db: AsyncSession, token: str, *, allow_inactive: bool = False
    ) -> ScoreInvite:
        invite = await self.repository.invite_by_token_hash(db, hash_invite_token(token))
        if not invite:
            raise ResourceNotFoundException("invite", code=ErrorCode.INVITE_NOT_FOUND)
        if allow_inactive:
            return invite
        status = self._display_status(invite)
        if status == InviteStatus.EXPIRED:
            invite.status = InviteStatus.EXPIRED
            await db.commit()
            raise ValidationException(ErrorCode.INVITE_EXPIRED, field="token")
        if status == InviteStatus.REVOKED:
            raise ValidationException(ErrorCode.INVITE_REVOKED, field="token")
        if status == InviteStatus.ACCEPTED:
            raise ValidationException(ErrorCode.INVITE_ALREADY_ACCEPTED, field="token")
        if status == InviteStatus.DECLINED:
            raise ValidationException(ErrorCode.INVITE_DECLINED, field="token")
        return invite

    async def _invite_by_uuid(self, db: AsyncSession, invite_uuid: str) -> ScoreInvite:
        invite = await self.repository.invite_by_uuid(db, invite_uuid)
        if not invite:
            raise ResourceNotFoundException("invite", invite_uuid, ErrorCode.INVITE_NOT_FOUND)
        status = self._display_status(invite)
        if status == InviteStatus.EXPIRED:
            invite.status = InviteStatus.EXPIRED
            await db.commit()
            raise ValidationException(ErrorCode.INVITE_EXPIRED, field="invite_id")
        if status == InviteStatus.REVOKED:
            raise ValidationException(ErrorCode.INVITE_REVOKED, field="invite_id")
        if status == InviteStatus.ACCEPTED:
            raise ValidationException(ErrorCode.INVITE_ALREADY_ACCEPTED, field="invite_id")
        if status == InviteStatus.DECLINED:
            raise ValidationException(ErrorCode.INVITE_DECLINED, field="invite_id")
        return invite

    async def _ensure_invite_target_user(
        self, db: AsyncSession, invite: ScoreInvite, user_id: int
    ) -> User:
        user = await db.get(User, user_id)
        if user is None:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        if not self._can_user_accept(invite, user):
            raise ValidationException(ErrorCode.INVITE_EMAIL_MISMATCH, field="email")
        return user

    async def _membership_for_score(
        self, db: AsyncSession, score: Score, membership_id: int
    ) -> ScoreMembership:
        membership = await self.repository.membership_by_id(db, membership_id)
        if not membership or membership.score_id != score.id:
            raise ResourceNotFoundException(
                "score_membership",
                str(membership_id),
                ErrorCode.MEMBERSHIP_NOT_FOUND,
            )
        return membership

    def _display_status(self, invite: ScoreInvite) -> InviteStatus:
        if (
            invite.status == InviteStatus.PENDING
            and invite.expires_at
            and invite.expires_at <= utc_now_naive()
        ):
            return InviteStatus.EXPIRED
        return invite.status

    def _can_user_accept(self, invite: ScoreInvite, user: User | None) -> bool:
        if user is None:
            return False
        if self._display_status(invite) != InviteStatus.PENDING:
            return False
        return invite.email == user.email.lower()

    async def _notify_invite_response(
        self,
        db: AsyncSession,
        *,
        invite: ScoreInvite,
        score: Score,
        actor: User,
        notification_type: str,
        title: str,
        action: str,
    ) -> None:
        actor_name = actor.display_name or actor.email
        await self.notification_service.create_event_best_effort(
            db,
            recipient_user_id=invite.created_by_user_id,
            actor_user_id=require_persisted_id(actor.id, entity="user"),
            type=notification_type,
            resource_type="score",
            resource_id=score.score_uuid,
            score_id=score.score_uuid,
            title=title,
            body=f"{actor_name} {action} your invite to {score.title}.",
            dedupe_key=f"{notification_type}:{invite.invite_uuid}:{invite.created_by_user_id}",
            data={
                "invite_id": invite.invite_uuid,
                "score_title": score.title,
                "role": invite.role.value,
            },
        )

    async def _invite_read(self, db: AsyncSession, invite: ScoreInvite) -> InviteRead:
        return InviteRead(
            invite_id=invite.invite_uuid,
            email=invite.email,
            role=invite.role,
            status=self._display_status(invite),
            expires_at=invite.expires_at,
            accepted_at=invite.accepted_at,
            revoked_at=invite.revoked_at,
            declined_at=invite.declined_at,
            created_at=invite.created_at,
            created_by=await self._actor(db, invite.created_by_user_id),
            accepted_by=await self._actor(db, invite.accepted_by_user_id),
        )

    async def _pending_invite_read(
        self, db: AsyncSession, invite: ScoreInvite
    ) -> PendingInviteRead:
        score = await db.get(Score, invite.score_id)
        if not score:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        return PendingInviteRead(
            invite_id=invite.invite_uuid,
            score_id=score.score_uuid,
            score_title=score.title,
            inviter=await self._actor(db, invite.created_by_user_id),
            email=invite.email,
            role=invite.role,
            status=self._display_status(invite),
            expires_at=invite.expires_at,
            created_at=invite.created_at,
        )

    async def _member_read(self, db: AsyncSession, membership: ScoreMembership) -> MemberRead:
        user = await db.get(User, membership.user_id)
        if not user:
            raise ResourceNotFoundException(
                "user", str(membership.user_id), ErrorCode.USER_NOT_FOUND
            )
        return MemberRead(
            membership_id=require_persisted_id(membership.id, entity="score membership"),
            user_id=require_persisted_id(user.id, entity="user"),
            display_name=user.display_name,
            email=user.email,
            avatar_url=user.avatar_url,
            role=membership.role,
            created_at=membership.created_at,
            revoked_at=membership.revoked_at,
        )

    async def _actor(self, db: AsyncSession, user_id: int | None) -> InviteActorRead | None:
        if user_id is None:
            return None
        user = await db.get(User, user_id)
        if not user:
            return None
        return InviteActorRead(
            display_name=user.display_name,
            email=user.email,
            avatar_url=user.avatar_url,
        )

    async def _queue_invite_email(
        self,
        db: AsyncSession,
        invite: ScoreInvite,
        score_title: str,
        token: str,
        locale: str,
    ) -> None:
        if not invite.email:
            return

        inviter = await self._actor(db, invite.created_by_user_id)
        inviter_name = (
            inviter.display_name
            if inviter and inviter.display_name
            else inviter.email
            if inviter
            else settings.PROJECT_NAME
        )
        invite_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/invite/{token}"
        email = build_invite_email(
            locale=locale,
            project_name=settings.PROJECT_NAME,
            inviter_name=inviter_name,
            score_title=score_title,
            role=invite.role,
            invite_url=invite_url,
        )

        await queue_mail(
            db,
            category="score.invite",
            dedupe_key=f"score-invite:{invite.invite_uuid}",
            recipient=invite.email,
            subject=email.subject,
            text_body=email.text_body,
            html_body=email.html_body,
            expires_at=invite.expires_at,
        )
