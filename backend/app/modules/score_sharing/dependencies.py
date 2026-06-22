from app.modules.score_sharing.service import ScoreSharingService


def get_score_sharing_service() -> ScoreSharingService:
    return ScoreSharingService()
