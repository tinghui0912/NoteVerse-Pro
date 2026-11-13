from __future__ import annotations

from dataclasses import dataclass
import enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException, UnauthorizedException
from app.db.models import (
    Score,
    ScoreMembership,
    ScoreRevision,
)
from app.db.models.score_access import (
    AccessOrigin,
    MembershipRole,
)
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_access.queries import active_score_predicate, active_membership_predicate
from app.shared.constants import ErrorCode


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
    revision: ScoreRevision
    origin: AccessOrigin
    capabilities: ScoreCapabilities
    membership: ScoreMembership | None = None


class ScoreAccessPolicy:
    async def resolve(
        self,
        db: AsyncSession,
        score_uuid: str,
        *,
        user_id: int | None = None,
        revision_uuid: str | None = None,
    ) -> ScoreAccessContext:
        score = (
            await db.execute(
                select(Score).where(
                    Score.score_uuid == score_uuid,
                    active_score_predicate(),
                )
            )
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
                    can_leave=False,
                    can_manage_guest_previews=True,
                    can_manage_members=True,
                    can_download=True,
                    can_practice=True,
                ),
            )

        if user_id is not None:
            membership = (
                await db.execute(
                    select(ScoreMembership).where(
                        ScoreMembership.score_id == score.id,
                        active_membership_predicate(user_id),
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
                        can_delete=False,
                        can_leave=True,
                        can_manage_guest_previews=False,
                        can_manage_members=False,
                        can_download=False,
                        can_practice=membership.role
                        in {MembershipRole.PRACTITIONER, MembershipRole.EDITOR},
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
        )
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


def _denial_code(action: ScoreAction) -> str:
    if action == ScoreAction.EDIT:
        return ErrorCode.NO_EDIT_ACCESS
    if action == ScoreAction.DELETE:
        return ErrorCode.NO_DELETE_ACCESS
    if action == ScoreAction.MANAGE_GUEST_PREVIEWS:
        return ErrorCode.NO_GUEST_PREVIEW_ACCESS
    if action == ScoreAction.DOWNLOAD:
        return ErrorCode.NO_DOWNLOAD_ACCESS
    if action == ScoreAction.PRACTICE:
        return ErrorCode.NO_PRACTICE_ACCESS
    return ErrorCode.NO_ACCESS


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None
