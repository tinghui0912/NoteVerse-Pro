from app.modules.revisions.service import RevisionService
from app.modules.scores.service import ScoreService


def get_score_service() -> ScoreService:
    return ScoreService()


def get_revision_service() -> RevisionService:
    return RevisionService()
