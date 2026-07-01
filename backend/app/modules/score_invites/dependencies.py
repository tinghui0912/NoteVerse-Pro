from app.modules.score_invites.service import ScoreInviteService


def get_score_invite_service() -> ScoreInviteService:
    return ScoreInviteService()
