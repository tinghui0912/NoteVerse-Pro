from fastapi import Response, APIRouter, Depends, Query

from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_optional_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.collaboration.dependencies import get_invitation_service, get_membership_service
from app.modules.collaboration.schemas import (
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
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService
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
def leave_score(
    score_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: MembershipService = Depends(get_membership_service),
):
    service.leave_score(db, score_id, require_persisted_id(current_user.id, entity="user"))
    return Response(status_code=204)


@score_router.get(
    "/{score_id}/invites",
    operation_id="scoreInvitesList",
    response_model=InviteListRead,
)
def list_score_invites(
    score_id: str,
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.list_invites(db, score_id, user_id, limit=limit, cursor=cursor)
    return result


@score_router.post(
    "/{score_id}/invites",
    operation_id="scoreInvitesCreate",
    response_model=InviteCreatedRead,
)
def create_score_invite(
    score_id: str,
    request: InviteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.create_invite(db, score_id, user_id, request)
    return result


@score_router.post(
    "/{score_id}/invites/{invite_id}/revoke",
    operation_id="scoreInviteRevoke",
    response_model=InviteRead,
)
def revoke_score_invite(
    score_id: str,
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.revoke_invite(db, score_id, invite_id, user_id)
    return result


@score_router.get(
    "/{score_id}/members",
    operation_id="scoreMembersList",
    response_model=MemberListRead,
)
def list_score_members(
    score_id: str,
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: MembershipService = Depends(get_membership_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.list_members(db, score_id, user_id, limit=limit, cursor=cursor)
    return result


@score_router.patch(
    "/{score_id}/members/{membership_id}",
    operation_id="scoreMemberUpdate",
    response_model=MemberRead,
)
def update_score_member(
    score_id: str,
    membership_id: int,
    request: MemberUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: MembershipService = Depends(get_membership_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.update_member(db, score_id, membership_id, user_id, request)
    return result


@score_router.delete(
    "/{score_id}/members/{membership_id}",
    operation_id="scoreMemberRemove",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def remove_score_member(
    score_id: str,
    membership_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: MembershipService = Depends(get_membership_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    service.remove_member(db, score_id, membership_id, user_id)
    return Response(status_code=204)


@invite_router.get("/{token}", operation_id="scoreInviteInspect", response_model=InviteAccessRead)
def inspect_invite(
    token: str,
    current_user: User | None = Depends(get_optional_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = current_user.id if current_user else None
    result = service.inspect_invite(db, token, user_id)
    return result


@invite_router.post(
    "/{token}/accept",
    operation_id="scoreInviteAccept",
    response_model=InviteAcceptRead,
)
def accept_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.accept_invite(db, token, user_id)
    return result


@me_router.get(
    "/invites",
    operation_id="accountPendingInvitesList",
    response_model=PendingInviteListRead,
)
def list_my_pending_invites(
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    cursor: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.list_my_pending_invites(db, user_id, limit=limit, cursor=cursor)
    return result


@me_router.post(
    "/invites/{invite_id}/accept",
    operation_id="accountPendingInviteAccept",
    response_model=InviteAcceptRead,
)
def accept_my_pending_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.accept_pending_invite(db, invite_id, user_id)
    return result


@me_router.post(
    "/invites/{invite_id}/decline",
    operation_id="accountPendingInviteDecline",
    response_model=PendingInviteRead,
)
def decline_my_pending_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: InvitationService = Depends(get_invitation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.decline_pending_invite(db, invite_id, user_id)
    return result
