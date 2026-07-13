from app.modules.score_assets.service import ScoreAssetService


def get_score_asset_service() -> ScoreAssetService:
    return ScoreAssetService()
