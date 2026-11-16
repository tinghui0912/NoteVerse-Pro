from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService


def get_invitation_service() -> InvitationService:
    return InvitationService()


def get_membership_service() -> MembershipService:
    return MembershipService()
