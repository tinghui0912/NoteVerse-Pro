from app.modules.scores.service import ScoreService


def get_my_scores_service() -> ScoreService:
    return ScoreService()
