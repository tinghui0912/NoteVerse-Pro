from fastapi import Response, APIRouter, Depends, Query

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.score_invites.dependencies import get_score_invite_service
from app.modules.score_invites.schemas import (
    InviteListRead,
    MemberListRead,
    PendingInviteListRead,
    InviteAcceptRead,
    InviteAccessRead,
    InviteCreateRequest,
    InviteCreatedRead,
    InviteRead,
    MemberRead,
    MemberUpdateRequest,
    PendingInviteRead,
)
from app.modules.score_invites.service import ScoreInviteService
from .pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE


score_router = APIRouter()
invite_router = APIRouter()
me_router = APIRouter()


@me_router.delete(
    "/scores/{score_id}/membership",
    operation_id="scoreMembershipLeave",
    status_code=204,
    response_model=None,
    response_class=Response,
)
async def leave_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    await service.leave_score(db, score_id, require_persisted_id(current_user.id, entity="user"))
    return Response(status_code=204)


@score_router.get(
    "/{score_id}/invites",
    operation_id="scoreInvitesList",
    response_model=InviteListRead,
)
async def list_score_invites(
    score_id: str,
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_invites(db, score_id, user_id, limit=limit, cursor=cursor)
    return result


@score_router.post(
    "/{score_id}/invites",
    operation_id="scoreInvitesCreate",
    response_model=InviteCreatedRead,
)
async def create_score_invite(
    score_id: str,
    request: InviteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.create_invite(db, score_id, user_id, request)
    return result


@score_router.post(
    "/{score_id}/invites/{invite_id}/revoke",
    operation_id="scoreInviteRevoke",
    response_model=InviteRead,
)
async def revoke_score_invite(
    score_id: str,
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.revoke_invite(db, score_id, invite_id, user_id)
    return result


@score_router.get(
    "/{score_id}/members",
    operation_id="scoreMembersList",
    response_model=MemberListRead,
)
async def list_score_members(
    score_id: str,
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_members(db, score_id, user_id, limit=limit, cursor=cursor)
    return result


@score_router.patch(
    "/{score_id}/members/{membership_id}",
    operation_id="scoreMemberUpdate",
    response_model=MemberRead,
)
async def update_score_member(
    score_id: str,
    membership_id: int,
    request: MemberUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.update_member(db, score_id, membership_id, user_id, request)
    return result


@score_router.delete(
    "/{score_id}/members/{membership_id}",
    operation_id="scoreMemberRemove",
    response_model=MemberRead,
)
async def remove_score_member(
    score_id: str,
    membership_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.remove_member(db, score_id, membership_id, user_id)
    return result


@invite_router.get("/{token}", operation_id="scoreInviteInspect", response_model=InviteAccessRead)
async def inspect_invite(
    token: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = current_user.id if current_user else None
    result = await service.inspect_invite(db, token, user_id)
    return result


@invite_router.post(
    "/{token}/accept",
    operation_id="scoreInviteAccept",
    response_model=InviteAcceptRead,
)
async def accept_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.accept_invite(db, token, user_id)
    return result


@me_router.get(
    "/invites",
    operation_id="accountPendingInvitesList",
    response_model=PendingInviteListRead,
)
async def list_my_pending_invites(
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_my_pending_invites(db, user_id, limit=limit, cursor=cursor)
    return result


@me_router.post(
    "/invites/{invite_id}/accept",
    operation_id="accountPendingInviteAccept",
    response_model=InviteAcceptRead,
)
async def accept_my_pending_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.accept_pending_invite(db, invite_id, user_id)
    return result


@me_router.post(
    "/invites/{invite_id}/decline",
    operation_id="accountPendingInviteDecline",
    response_model=PendingInviteRead,
)
async def decline_my_pending_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.decline_pending_invite(db, invite_id, user_id)
    return result
