from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.score_invites.dependencies import get_score_invite_service
from app.modules.score_invites.schemas import (
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
from app.shared.constants import SuccessCode
from app.shared.responses import APIResponse, success_response

score_router = APIRouter()
invite_router = APIRouter()
me_router = APIRouter()


@score_router.get("/{score_id}/invites", response_model=APIResponse[list[InviteRead]])
async def list_score_invites(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_invites(db, score_id, user_id)
    return success_response(data=result)


@score_router.post("/{score_id}/invites", response_model=APIResponse[InviteCreatedRead])
async def create_score_invite(
    score_id: str,
    request: InviteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.create_invite(db, score_id, user_id, request)
    return success_response(data=result, message=SuccessCode.INVITE_CREATED)


@score_router.post("/{score_id}/invites/{invite_id}/revoke", response_model=APIResponse[InviteRead])
async def revoke_score_invite(
    score_id: str,
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.revoke_invite(db, score_id, invite_id, user_id)
    return success_response(data=result, message=SuccessCode.INVITE_REVOKED)


@score_router.delete("/{score_id}/invites/{invite_id}", response_model=APIResponse[dict[str, bool]])
async def delete_score_invite(
    score_id: str,
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await service.delete_invite(db, score_id, invite_id, user_id)
    return success_response(data={"deleted": True})


@score_router.get("/{score_id}/members", response_model=APIResponse[list[MemberRead]])
async def list_score_members(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_members(db, score_id, user_id)
    return success_response(data=result)


@score_router.patch("/{score_id}/members/{membership_id}", response_model=APIResponse[MemberRead])
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
    return success_response(data=result, message=SuccessCode.MEMBER_UPDATED)


@score_router.delete("/{score_id}/members/{membership_id}", response_model=APIResponse[MemberRead])
async def remove_score_member(
    score_id: str,
    membership_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.remove_member(db, score_id, membership_id, user_id)
    return success_response(data=result, message=SuccessCode.MEMBER_REMOVED)


@invite_router.get("/{token}", response_model=APIResponse[InviteAccessRead])
async def inspect_invite(
    token: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = current_user.id if current_user else None
    result = await service.inspect_invite(db, token, user_id)
    return success_response(data=result)


@invite_router.post("/{token}/accept", response_model=APIResponse[InviteAcceptRead])
async def accept_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.accept_invite(db, token, user_id)
    return success_response(data=result, message=SuccessCode.INVITE_ACCEPTED)


@me_router.get("/invites", response_model=APIResponse[list[PendingInviteRead]])
async def list_my_pending_invites(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_my_pending_invites(db, user_id)
    return success_response(data=result)


@me_router.post("/invites/{invite_id}/accept", response_model=APIResponse[InviteAcceptRead])
async def accept_my_pending_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.accept_pending_invite(db, invite_id, user_id)
    return success_response(data=result, message=SuccessCode.INVITE_ACCEPTED)


@me_router.post("/invites/{invite_id}/decline", response_model=APIResponse[PendingInviteRead])
async def decline_my_pending_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: ScoreInviteService = Depends(get_score_invite_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.decline_pending_invite(db, invite_id, user_id)
    return success_response(data=result, message=SuccessCode.INVITE_DECLINED)
