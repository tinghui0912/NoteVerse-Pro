from fastapi import Request
from app.platform.config.application import InvitationConfig
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService


def get_invitation_service(request: Request) -> InvitationService:
    return InvitationService(
        config=InvitationConfig.model_validate(request.app.state.settings.model_dump())
    )


def get_membership_service() -> MembershipService:
    return MembershipService()
