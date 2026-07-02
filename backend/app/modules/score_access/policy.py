from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import enum
import hashlib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import (
    Score,
    ScoreMembership,
    ScorePublication,
    ScoreRevision,
    ScoreShareGrant,
    ShareGrantRedemption,
)
from app.db.models.score_access import (
    AccessOrigin,
    MembershipRole,
    PublicationStatus,
    ShareTargetMode,
)
from app.modules.score_access.schemas import ScoreCapabilities
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class ScoreAction(str, enum.Enum):
    VIEW = "VIEW"
    EDIT = "EDIT"
    DELETE = "DELETE"
    MANAGE_SHARING = "MANAGE_SHARING"
    MANAGE_MEMBERS = "MANAGE_MEMBERS"
    DOWNLOAD = "DOWNLOAD"
    PRACTICE = "PRACTICE"
    PUBLISH = "PUBLISH"


@dataclass(frozen=True)
class ScoreAccessContext:
    score: Score
    revision: ScoreRevision
    origin: AccessOrigin
    capabilities: ScoreCapabilities
    membership: ScoreMembership | None = None
    grant: ScoreShareGrant | None = None
    publication: ScorePublication | None = None


class ScoreAccessPolicy:
    async def resolve(
        self,
        db: AsyncSession,
        score_uuid: str,
        *,
        user_id: int | None = None,
        revision_uuid: str | None = None,
        share_token: str | None = None,
        public_slug: str | None = None,
        now: datetime | None = None,
    ) -> ScoreAccessContext:
        score = (
            await db.execute(select(Score).where(Score.score_uuid == score_uuid))
        ).scalar_one_or_none()
        if not score:
            raise ResourceNotFoundException("score", score_uuid, ErrorCode.SCORE_NOT_FOUND)

        requested_revision = await self._revision(db, score, revision_uuid)
        if user_id == score.owner_user_id:
            return ScoreAccessContext(
                score=score,
                revision=requested_revision,
                origin=AccessOrigin.OWNER,
                capabilities=ScoreCapabilities(
                    can_view=True,
                    can_edit=True,
                    can_delete=True,
                    can_manage_sharing=True,
                    can_manage_members=True,
                    can_download=True,
                    can_practice=True,
                    can_publish=True,
                ),
            )

        if user_id is not None:
            membership = (
                await db.execute(
                    select(ScoreMembership).where(
                        ScoreMembership.score_id == score.id,
                        ScoreMembership.user_id == user_id,
                        ScoreMembership.__table__.c.revoked_at.is_(None),
                    )
                )
            ).scalar_one_or_none()
            if membership:
                editor = membership.role == MembershipRole.EDITOR
                return ScoreAccessContext(
                    score=score,
                    revision=requested_revision,
                    origin=AccessOrigin.MEMBERSHIP,
                    membership=membership,
                    capabilities=ScoreCapabilities(
                        can_view=True,
                        can_edit=editor,
                        can_download=True,
                        can_practice=True,
                    ),
                )

        current_time = now or utc_now_naive()
        if user_id is not None:
            redeemed = await self._valid_redeemed_grant(
                db, score, user_id, current_time
            )
            if redeemed:
                target_revision = await self._grant_revision(db, score, redeemed)
                if revision_uuid is None or target_revision.id == requested_revision.id:
                    return ScoreAccessContext(
                        score=score,
                        revision=target_revision,
                        origin=AccessOrigin.SHARE,
                        grant=redeemed,
                        capabilities=ScoreCapabilities(
                            can_view=True,
                            can_download=redeemed.allow_download,
                            can_practice=redeemed.allow_practice,
                        ),
                    )
        if share_token:
            grant = await self._valid_grant(db, score, share_token, current_time)
            if grant:
                target_revision = await self._grant_revision(db, score, grant)
                if revision_uuid is None or target_revision.id == requested_revision.id:
                    return ScoreAccessContext(
                        score=score,
                        revision=target_revision,
                        origin=AccessOrigin.SHARE,
                        grant=grant,
                        capabilities=ScoreCapabilities(
                            can_view=True,
                            can_download=grant.allow_download,
                            can_practice=grant.allow_practice,
                        ),
                    )

        if public_slug:
            publication = (
                await db.execute(
                    select(ScorePublication).where(
                        ScorePublication.score_id == score.id,
                        ScorePublication.public_slug == public_slug,
                        ScorePublication.status == PublicationStatus.PUBLISHED,
                    )
                )
            ).scalar_one_or_none()
            if publication and (
                revision_uuid is None
                or publication.published_revision_id == requested_revision.id
            ):
                published_revision = await db.get(
                    ScoreRevision, publication.published_revision_id
                )
                if not published_revision:
                    raise UnauthorizedException(ErrorCode.NO_ACCESS)
                return ScoreAccessContext(
                    score=score,
                    revision=published_revision,
                    origin=AccessOrigin.PUBLICATION,
                    publication=publication,
                    capabilities=ScoreCapabilities(
                        can_view=True,
                        can_download=publication.allow_download,
                        can_practice=publication.allow_practice,
                    ),
                )

        raise UnauthorizedException(ErrorCode.NO_ACCESS, {"score_id": score_uuid})

    async def authorize(
        self,
        db: AsyncSession,
        score_uuid: str,
        action: ScoreAction,
        **context: object,
    ) -> ScoreAccessContext:
        access = await self.resolve(
            db,
            score_uuid,
            user_id=_optional_int(context.get("user_id")),
            revision_uuid=_optional_str(context.get("revision_uuid")),
            share_token=_optional_str(context.get("share_token")),
            public_slug=_optional_str(context.get("public_slug")),
        )
        allowed = {
            ScoreAction.VIEW: access.capabilities.can_view,
            ScoreAction.EDIT: access.capabilities.can_edit,
            ScoreAction.DELETE: access.capabilities.can_delete,
            ScoreAction.MANAGE_SHARING: access.capabilities.can_manage_sharing,
            ScoreAction.MANAGE_MEMBERS: access.capabilities.can_manage_members,
            ScoreAction.DOWNLOAD: access.capabilities.can_download,
            ScoreAction.PRACTICE: access.capabilities.can_practice,
            ScoreAction.PUBLISH: access.capabilities.can_publish,
        }[action]
        if not allowed:
            raise UnauthorizedException(
                _denial_code(action),
                {"score_id": score_uuid, "action": action.value},
            )
        return access

    async def _revision(
        self, db: AsyncSession, score: Score, revision_uuid: str | None
    ) -> ScoreRevision:
        if revision_uuid:
            revision = (
                await db.execute(
                    select(ScoreRevision).where(
                        ScoreRevision.revision_uuid == revision_uuid,
                        ScoreRevision.score_id == score.id,
                    )
                )
            ).scalar_one_or_none()
        else:
            revision = await db.get(ScoreRevision, score.head_revision_id)
        if not revision:
            raise ResourceNotFoundException(
                "revision", revision_uuid or "head", ErrorCode.REVISION_NOT_FOUND
            )
        return revision

    async def _valid_grant(
        self,
        db: AsyncSession,
        score: Score,
        token: str,
        now: datetime,
    ) -> ScoreShareGrant | None:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        grant = (
            await db.execute(
                select(ScoreShareGrant).where(
                    ScoreShareGrant.score_id == score.id,
                    ScoreShareGrant.token_hash == token_hash,
                )
            )
        ).scalar_one_or_none()
        if not grant or grant.revoked_at is not None:
            return None
        if grant.expires_at is not None and grant.expires_at <= now:
            return None
        return grant

    async def _valid_redeemed_grant(
        self,
        db: AsyncSession,
        score: Score,
        user_id: int,
        now: datetime,
    ) -> ScoreShareGrant | None:
        rows = await db.execute(
            select(ScoreShareGrant)
            .join(
                ShareGrantRedemption,
                ShareGrantRedemption.grant_id == ScoreShareGrant.id,
            )
            .where(
                ScoreShareGrant.score_id == score.id,
                ShareGrantRedemption.user_id == user_id,
                ScoreShareGrant.__table__.c.revoked_at.is_(None),
            )
            .order_by(ShareGrantRedemption.__table__.c.created_at.desc())
        )
        for grant in rows.scalars().all():
            if grant.expires_at is None or grant.expires_at > now:
                return grant
        return None

    async def _grant_revision(
        self, db: AsyncSession, score: Score, grant: ScoreShareGrant
    ) -> ScoreRevision:
        revision_id = (
            score.head_revision_id
            if grant.target_mode == ShareTargetMode.LATEST
            else grant.target_revision_id
        )
        revision = await db.get(ScoreRevision, revision_id)
        if not revision or revision.score_id != score.id:
            raise UnauthorizedException(ErrorCode.NO_ACCESS)
        return revision


def hash_share_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _denial_code(action: ScoreAction) -> str:
    if action == ScoreAction.EDIT:
        return ErrorCode.NO_EDIT_ACCESS
    if action == ScoreAction.DELETE:
        return ErrorCode.NO_DELETE_ACCESS
    if action == ScoreAction.MANAGE_SHARING:
        return ErrorCode.NO_SHARE_ACCESS
    if action == ScoreAction.DOWNLOAD:
        return ErrorCode.NO_DOWNLOAD_ACCESS
    if action == ScoreAction.PRACTICE:
        return ErrorCode.NO_PRACTICE_ACCESS
    return ErrorCode.NO_ACCESS


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None
